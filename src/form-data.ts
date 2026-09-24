export interface FormDataEntry {
  key: string;
  value: string | Buffer;
  fileName?: string;
}

const entries = new WeakMap<FormData, FormDataEntry[]>();

const getEntries = (form: FormData): FormDataEntry[] => {
  const formEntries = entries.get(form);
  if (!formEntries) {
    throw new TypeError(
      "Expected a FormData instance created by sync-request-curl",
    );
  }
  return formEntries;
};

/**
 * A synchronous multipart/form-data builder compatible with sync-request.
 */
export class FormData {
  constructor() {
    entries.set(this, []);
  }

  append(key: string, value: string | Buffer, fileName?: string): void {
    getEntries(this).push({ key, value, fileName });
  }
}

export const getFormDataEntries = (form: FormData): FormDataEntry[] =>
  getEntries(form).map((entry) => ({ ...entry }));
