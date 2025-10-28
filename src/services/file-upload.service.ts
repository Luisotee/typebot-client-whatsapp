import { ServiceResponse } from "../types/common.types";
import { typebot } from "../config/config";
import { appLogger } from "../utils/logger";
import { withServiceResponse, withRetry } from "../utils/retry";

/**
 * Interface for upload URL generation request
 */
export interface GenerateUploadUrlRequest {
  sessionId: string;
  fileName: string;
  fileType: string;
}

/**
 * Interface for upload URL generation response
 */
export interface GenerateUploadUrlResponse {
  presignedUrl: string;
  formData: Record<string, string>;
  fileUrl?: string;
}

/**
 * Generates a presigned URL for file upload from Typebot API
 */
export async function generateUploadUrl(
  request: GenerateUploadUrlRequest,
  waId?: string
): Promise<ServiceResponse<GenerateUploadUrlResponse>> {
  const context = {
    waId,
    sessionId: request.sessionId,
    operation: "generate_upload_url",
  };

  // Replace /v1 with /v2 for the file upload endpoint
  const v2ApiBase = typebot.apiBase.replace('/api/v1', '/api/v2');
  const endpoint = `${v2ApiBase}/generate-upload-url`;

  appLogger.info(
    {
      ...context,
      endpoint,
      fileName: request.fileName,
      fileType: request.fileType,
    },
    "Requesting presigned upload URL from Typebot"
  );

  return withServiceResponse(async () => {
    const response = await makeApiCall<GenerateUploadUrlResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify(request),
    });

    appLogger.info(
      {
        ...context,
        hasPresignedUrl: !!response.presignedUrl,
        hasFormData: !!response.formData,
        fileUrl: response.fileUrl,
      },
      "Successfully generated presigned upload URL"
    );

    return response;
  }, context);
}

/**
 * Uploads file buffer to S3 using presigned URL
 */
export async function uploadFileToS3(
  presignedUrl: string,
  formData: Record<string, string>,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  waId?: string
): Promise<ServiceResponse<void>> {
  const context = {
    waId,
    operation: "upload_file_to_s3",
    fileName,
    fileSize: fileBuffer.length,
  };

  appLogger.info(
    {
      ...context,
      mimeType,
      presignedUrl,
      formData: formData, // Log complete form data
    },
    "Uploading file to S3 - Full form data"
  );

  return withServiceResponse(async () => {
    return withRetry(
      async () => {
        // Create native FormData with all fields from presignedUrl response
        const form = new FormData();

        // Append all form data fields first (in the order they were provided)
        Object.entries(formData).forEach(([key, value]) => {
          appLogger.debug({ key, value }, "Appending form field");
          form.append(key, value);
        });

        // Create a Blob from the buffer and append it as 'file'
        // This matches browser behavior exactly
        const fileBlob = new Blob([fileBuffer], { type: mimeType });
        form.append("file", fileBlob, fileName);

        // Upload to S3 using fetch
        // IMPORTANT: Do NOT manually set Content-Type - let fetch add it with boundary
        const response = await fetch(presignedUrl, {
          method: "POST",
          body: form,
        });

        if (!response.ok) {
          const errorText = await response.text();
          appLogger.error(
            {
              ...context,
              status: response.status,
              statusText: response.statusText,
              errorBody: errorText,
            },
            "S3 upload failed"
          );
          throw new Error(
            `S3 upload failed: ${response.status} ${response.statusText} - ${errorText}`
          );
        }

        appLogger.info(
          {
            ...context,
            status: response.status,
          },
          "Successfully uploaded file to S3"
        );
      },
      { maxAttempts: 3, delayMs: 1000, backoffMultiplier: 2 },
      context
    );
  }, context);
}

/**
 * Complete file upload workflow: generate URL, upload file, return file URL
 */
export async function uploadFileToTypebot(
  sessionId: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  waId?: string
): Promise<ServiceResponse<string>> {
  const context = {
    waId,
    sessionId,
    operation: "upload_file_to_typebot",
    fileName,
    fileSize: fileBuffer.length,
  };

  appLogger.info(
    {
      ...context,
      mimeType,
    },
    "Starting complete file upload workflow"
  );

  return withServiceResponse(async () => {
    // Step 1: Generate presigned upload URL
    const urlResult = await generateUploadUrl(
      {
        sessionId,
        fileName,
        fileType: mimeType,
      },
      waId
    );

    if (!urlResult.success || !urlResult.data) {
      throw new Error(
        `Failed to generate upload URL: ${urlResult.error || "Unknown error"}`
      );
    }

    const { presignedUrl, formData, fileUrl } = urlResult.data;

    // Step 2: Upload file to S3
    const uploadResult = await uploadFileToS3(
      presignedUrl,
      formData,
      fileBuffer,
      fileName,
      mimeType,
      waId
    );

    if (!uploadResult.success) {
      throw new Error(
        `Failed to upload file to S3: ${uploadResult.error || "Unknown error"}`
      );
    }

    // Step 3: Return the file URL (may be included in the generate response)
    // If not provided, construct it from the presigned URL
    const finalFileUrl = fileUrl || extractFileUrlFromPresigned(presignedUrl);

    appLogger.info(
      {
        ...context,
        fileUrl: finalFileUrl,
      },
      "File upload workflow completed successfully"
    );

    return finalFileUrl;
  }, context);
}

/**
 * Extracts the public file URL from a presigned URL
 */
function extractFileUrlFromPresigned(presignedUrl: string): string {
  try {
    const url = new URL(presignedUrl);
    // Remove query parameters to get the base file URL
    return `${url.origin}${url.pathname}`;
  } catch (error) {
    appLogger.warn(
      { presignedUrl, error },
      "Failed to extract file URL from presigned URL"
    );
    // Return the presigned URL as fallback (it might still work)
    return presignedUrl;
  }
}

/**
 * Detects MIME type from file buffer
 */
export function detectMimeType(buffer: Buffer, fileName?: string): string {
  // Check magic bytes for common image formats
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return "image/gif";
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  ) {
    return "image/webp";
  }

  // Fallback to filename extension
  if (fileName) {
    const ext = fileName.toLowerCase().split(".").pop();
    switch (ext) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "gif":
        return "image/gif";
      case "webp":
        return "image/webp";
      case "pdf":
        return "application/pdf";
      default:
        return "application/octet-stream";
    }
  }

  return "application/octet-stream";
}

/**
 * Makes an authenticated API call to Typebot
 */
async function makeApiCall<T>(endpoint: string, options: RequestInit): Promise<T> {
  return withRetry(
    async () => {
      const response = await fetch(endpoint, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${typebot.apiKey}`,
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMessage = `Typebot API error: ${response.status} ${response.statusText} - ${errorText}`;

        appLogger.error(
          {
            endpoint,
            status: response.status,
            statusText: response.statusText,
            errorBody: errorText,
          },
          errorMessage
        );

        const error = new Error(errorMessage);
        (error as any).status = response.status;
        throw error;
      }

      const data = await response.json();
      return data as T;
    },
    { maxAttempts: 3, delayMs: 1000, backoffMultiplier: 2 },
    { operation: "typebot_file_upload_api_call" }
  );
}
