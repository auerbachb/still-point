export const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 30;
export const USERNAME_ERROR =
  "Username must be 3-30 characters (letters, numbers, underscores)";

export function isValidUsername(value: string): boolean {
  return (
    value.length >= MIN_USERNAME_LENGTH &&
    value.length <= MAX_USERNAME_LENGTH &&
    USERNAME_REGEX.test(value)
  );
}
