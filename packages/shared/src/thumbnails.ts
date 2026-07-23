export interface Dimensions {
  width: number;
  height: number;
}

export interface TimelineThumbnailVariant {
  objectKey: string;
  dimensions: Dimensions;
}

export interface TimelineThumbnails {
  small: TimelineThumbnailVariant;
  large: TimelineThumbnailVariant;
}
