const PLACEHOLDER_KEY_PATTERNS = [/placeholder/i, /example/i, /changeme/i, /your[_-]?key/i];

function readRawPublishableKey() {
  return process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
}

export function isValidClerkPublishableKey(key: string | undefined) {
  if (!key) {
    return false;
  }

  if (!/^pk_(test|live)_/.test(key)) {
    return false;
  }

  if (PLACEHOLDER_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
    return false;
  }

  return true;
}

export function getClerkPublishableKey() {
  const key = readRawPublishableKey();
  return isValidClerkPublishableKey(key) ? key : undefined;
}

export function hasConfiguredClerk() {
  return !!getClerkPublishableKey();
}
