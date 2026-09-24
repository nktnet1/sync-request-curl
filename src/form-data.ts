export interface FormDataEntry {
  key: string;
  value: string | Buffer;
  fileName?: string;
}

const entries = new WeakMap<FormData, FormDataEntry[]>();

/**
 * A synchronous multipart/form-data builder compatible with sync-request.
 */
export class FormData {
  constructor() {
    entries.set(this, []);
  }

  append(key: string, value: string | Buffer, fileName?: string): void {
    entries.get(this)?.push({ key, value, fileName });
  }
}

export const getFormDataEntries = (form: FormData): FormDataEntry[] => {
  const formEntries = entries.get(form);
  if (!formEntries) {
    throw new TypeError(
      "Expected a FormData instance created by sync-request-curl",
    );
  }
  return formEntries.map((entry) => ({ ...entry }));
};
