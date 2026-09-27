import {
  type Application,
  Converter,
  type Reflection,
  ReflectionKind,
} from "typedoc";

const hasTypeAliasAncestor = (reflection: Reflection): boolean => {
  let parent = reflection.parent;
  while (parent) {
    if (parent.kindOf(ReflectionKind.TypeAlias)) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
};

/**
 * Properties synthesized while expanding schema-derived type aliases can retain
 * the Valibot object-entry expression as a TypeDoc `defaultValue`. A type alias
 * cannot define runtime property defaults, so those values are documentation
 * artefacts rather than defaults of the public API.
 */
export function removeTypeAliasPropertyDefaults(app: Application): void {
  app.converter.on(Converter.EVENT_RESOLVE_END, ({ project }) => {
    for (const reflection of Object.values(project.reflections)) {
      if (
        !reflection.isDeclaration() ||
        !reflection.kindOf(ReflectionKind.Property) ||
        reflection.defaultValue === undefined ||
        !hasTypeAliasAncestor(reflection)
      ) {
        continue;
      }

      reflection.defaultValue = undefined;
    }
  });
}
