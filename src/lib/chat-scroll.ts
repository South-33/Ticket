type AutoFollowStateInput = {
  wasEnabled: boolean;
  isOutputting: boolean;
  movedUp: boolean;
  bottomDistance: number;
  attachThresholdPx: number;
  detachThresholdPx: number;
};

export function getNextAutoFollowEnabled({
  wasEnabled,
  isOutputting,
  movedUp,
  bottomDistance,
  attachThresholdPx,
  detachThresholdPx,
}: AutoFollowStateInput): boolean {
  if (bottomDistance <= attachThresholdPx) {
    return true;
  }

  if (movedUp && bottomDistance > detachThresholdPx) {
    return false;
  }

  if (!isOutputting) {
    return wasEnabled;
  }

  return wasEnabled;
}
