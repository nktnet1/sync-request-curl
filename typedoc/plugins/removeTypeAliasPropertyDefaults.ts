import {
  type Application,
  Converter,
  type Reflection,
  ReflectionKind,
} from "typedoc";

const hasNonRuntimePropertyContainer = (reflection: Reflection): boolean => {
  let parent = reflection.parent;
  while (parent) {
    if (
      parent.kindOf(ReflectionKind.TypeAlias) ||
      parent.kindOf(ReflectionKind.Interface)
    ) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
};

/**
 * Properties synthesized while expanding schema-derived type aliases or
 * interface-shaped aliases can retain the Valibot object-entry expression as a
 * TypeDoc `defaultValue`. Neither type aliases nor interfaces define runtime
 * property defaults, so those values are documentation artefacts rather than
 * defaults of the public API.
 */
export function removeTypeAliasPropertyDefaults(app: Application): void {
  app.converter.on(Converter.EVENT_RESOLVE_END, ({ project }) => {
    for (const reflection of Object.values(project.reflections)) {
      if (
        !reflection.isDeclaration() ||
        !reflection.kindOf(ReflectionKind.Property) ||
        reflection.defaultValue === undefined ||
        !hasNonRuntimePropertyContainer(reflection)
      ) {
        continue;
      }

      reflection.defaultValue = undefined;
    }
  });
}
