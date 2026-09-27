import {
  type Application,
  Converter,
  ReferenceType,
  ReflectionKind,
} from "typedoc";

/**
 * typedoc-plugin-valibot expands schema-derived types at reference sites.
 * Keep the public request signature linked to the named Options reflection
 * while still allowing the Options section itself to be schema-derived.
 */
export function preserveOptionsReference(app: Application): void {
  app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    const { project } = context;
    const optionsReflection = Object.values(project.reflections).find(
      (reflection) =>
        reflection.name === "Options" &&
        reflection.isDeclaration() &&
        !reflection.isReference() &&
        reflection.kindOf([ReflectionKind.Interface, ReflectionKind.TypeAlias]),
    );

    if (!optionsReflection) {
      throw new Error("TypeDoc could not find the public Options reflection");
    }

    let preservedReferences = 0;

    for (const reflection of Object.values(project.reflections)) {
      if (!reflection.isParameter() || reflection.name !== "options") {
        continue;
      }

      const signature = reflection.parent;
      if (signature?.parent?.name !== "request") {
        continue;
      }

      reflection.type = ReferenceType.createResolvedReference(
        "Options",
        optionsReflection,
        project,
      );
      preservedReferences += 1;
    }

    if (preservedReferences === 0) {
      throw new Error(
        "TypeDoc could not preserve the request options type reference",
      );
    }
  });
}
