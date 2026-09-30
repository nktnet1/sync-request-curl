import * as v from "valibot";

export const parseSchema = <
  TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(
  schema: TSchema,
  input: unknown,
): v.InferOutput<TSchema> => {
  const result = v.safeParse(schema, input);
  if (!result.success) {
    throw new TypeError(v.summarize(result.issues));
  }
  return result.output;
};
