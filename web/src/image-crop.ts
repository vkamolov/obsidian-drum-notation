export interface CropSize {
  width: number;
  height: number;
}

export interface CropPoint {
  x: number;
  y: number;
}

export interface CropRect extends CropPoint, CropSize {}

export const MAX_FOCUSED_CROP_SCALE = 4;
export const MAX_FOCUSED_CROP_SIDE = 2048;

export function getContainedImageRect(container: CropSize, image: CropSize): CropRect | null {
  if (container.width <= 0 || container.height <= 0 || image.width <= 0 || image.height <= 0) {
    return null;
  }

  const scale = Math.min(container.width / image.width, container.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;

  return {
    x: (container.width - width) / 2,
    y: (container.height - height) / 2,
    width,
    height
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function mapDisplaySelectionToSource(
  start: CropPoint,
  end: CropPoint,
  container: CropSize,
  image: CropSize
): CropRect | null {
  const displayed = getContainedImageRect(container, image);
  const selection = getClampedDisplaySelection(start, end, container, image);
  if (!displayed || !selection) {
    return null;
  }

  const scaleX = image.width / displayed.width;
  const scaleY = image.height / displayed.height;
  const sourceLeft = clamp(Math.floor((selection.x - displayed.x) * scaleX), 0, image.width - 1);
  const sourceTop = clamp(Math.floor((selection.y - displayed.y) * scaleY), 0, image.height - 1);
  const sourceRight = clamp(Math.ceil((selection.x + selection.width - displayed.x) * scaleX), sourceLeft + 1, image.width);
  const sourceBottom = clamp(Math.ceil((selection.y + selection.height - displayed.y) * scaleY), sourceTop + 1, image.height);

  return {
    x: sourceLeft,
    y: sourceTop,
    width: sourceRight - sourceLeft,
    height: sourceBottom - sourceTop
  };
}

export function getClampedDisplaySelection(
  start: CropPoint,
  end: CropPoint,
  container: CropSize,
  image: CropSize
): CropRect | null {
  const displayed = getContainedImageRect(container, image);
  if (!displayed) {
    return null;
  }

  const startX = clamp(start.x, displayed.x, displayed.x + displayed.width);
  const startY = clamp(start.y, displayed.y, displayed.y + displayed.height);
  const endX = clamp(end.x, displayed.x, displayed.x + displayed.width);
  const endY = clamp(end.y, displayed.y, displayed.y + displayed.height);
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const right = Math.max(startX, endX);
  const bottom = Math.max(startY, endY);

  if (right - left < 2 || bottom - top < 2) {
    return null;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function getFocusedCropOutputSize(
  source: CropSize,
  maximumScale = MAX_FOCUSED_CROP_SCALE,
  maximumSide = MAX_FOCUSED_CROP_SIDE
): CropSize | null {
  if (source.width <= 0 || source.height <= 0 || maximumScale <= 0 || maximumSide <= 0) {
    return null;
  }

  const scale = Math.min(maximumScale, maximumSide / Math.max(source.width, source.height));

  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale))
  };
}
