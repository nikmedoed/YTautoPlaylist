// Project-wide type declarations for this JavaScript codebase. Documents globals and shared shapes used by editors.
export interface Video {
  id: string;
  publishedAt: Date;
  title?: string;
  channelId?: string;
  channelTitle?: string;
  tags?: string[];
  duration?: string;
  liveStreamingDetails?: Record<string, any>;
  playlist?: string;
}

export interface ChannelInfo {
  id: string;
  title: string;
  uploads: string;
}
