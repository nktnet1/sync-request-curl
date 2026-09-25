import * as v from "valibot";

export interface FormDataEntry {
  key: string;
  value: string | Buffer;
  fileName?: string;
}

const formDataEntrySchema = v.object({
  key: v.string(),
  value: v.union([v.string(), v.instance(Buffer)]),
  fileName: v.optional(v.string()),
});
const entries = new WeakMap<FormData, FormDataEntry[]>();

const getEntries = (form: FormData): FormDataEntry[] => {
  v.parse(v.instance(FormData), form);
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
    const entry = v.parse(formDataEntrySchema, { key, value, fileName });
    getEntries(this).push(entry);
  }
}

export const getFormDataEntries = (form: FormData): FormDataEntry[] =>
  getEntries(form).map((entry) => ({ ...entry }));
