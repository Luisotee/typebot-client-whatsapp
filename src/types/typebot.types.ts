export interface TypebotStartChatRequest {
  message?: string;
  isStreamEnabled?: boolean;
  prefilledVariables?: Record<string, string>;
}

export interface TypebotStartChatResponse {
  sessionId: string;
  messages: TypebotMessage[];
  input?: TypebotInput;
  resultId?: string;
  typebot: TypebotMetadata;
  clientSideActions?: TypebotClientSideAction[];
}

export interface TypebotContinueChatRequest {
  message?: string | TypebotMessagePayload;
  sessionId: string;
}

export interface TypebotMessagePayload {
  type?: string;
  text?: string;
  attachedFileUrls?: string[];
}

export interface TypebotContinueChatResponse {
  messages: TypebotMessage[];
  input?: TypebotInput;
  sessionId: string;
  redirect?: TypebotRedirect;
  clientSideActions?: TypebotClientSideAction[];
}

export interface TypebotRedirect {
  url: string;
  isNewTab?: boolean;
}

export interface TypebotClientSideAction {
  type: string;
  redirect?: TypebotRedirect;
  url?: string;
  isNewTab?: boolean;
  [key: string]: any;
}

export interface TypebotMessage {
  id: string;
  type: TypebotMessageType;
  content: TypebotMessageContent;
}

export type TypebotMessageType = 
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'embed';

export interface TypebotMessageContent {
  richText?: TypebotRichText[];
  url?: string;
  alt?: string;
}

export interface TypebotRichText {
  type: 'p' | 'inline-code' | 'a';
  children: TypebotRichTextChild[];
}

export interface TypebotRichTextChild {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  url?: string;
}

export interface TypebotInput {
  id: string;
  type: TypebotInputType;
  options?: TypebotInputOptions;
}

export type TypebotInputType = 
  | 'text input'
  | 'choice input'
  | 'pictureChoice input'
  | 'number input'
  | 'email input'
  | 'url input'
  | 'phone number input'
  | 'date input'
  | 'payment input'
  | 'rating input'
  | 'file input';

export interface TypebotInputOptions {
  labels?: string[];
  buttonLabel?: string;
  searchInputPlaceholder?: string;
  isMultipleChoice?: boolean;
  dynamicItems?: {
    isEnabled: boolean;
    pictureSrcs: string[];
  };
}

export interface TypebotMetadata {
  id: string;
  name: string;
  theme: {
    chat: {
      backgroundColor: string;
      fontFamily: string;
    };
  };
}

export interface TypebotApiError {
  error: {
    message: string;
    code: string;
  };
}

export interface TypebotChoice {
  id: string;
  content: string;
}