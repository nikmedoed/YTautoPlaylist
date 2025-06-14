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
