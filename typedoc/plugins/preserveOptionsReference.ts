import {
  type Application,
  Converter,
  ReferenceType,
  ReflectionKind,
} from "typedoc";

/**
 * Keep request parameters linked to their named public type reflections.
 * typedoc-plugin-valibot expands schema-derived types at reference sites, and
 * TypeDoc may otherwise inline simple aliases such as HttpVerb.
 */
export function preserveOptionsReference(app: Application): void {
  app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    const { project } = context;
    const publicTypes = new Map(
      ["HttpVerb", "Options"].map((name) => {
        const reflection = Object.values(project.reflections).find(
          (candidate) =>
            candidate.name === name &&
            candidate.isDeclaration() &&
            !candidate.isReference() &&
            candidate.kindOf([
              ReflectionKind.Interface,
              ReflectionKind.TypeAlias,
            ]),
        );
        if (!reflection) {
          throw new Error(
            `TypeDoc could not find the public ${name} reflection`,
          );
        }
        return [name, reflection] as const;
      }),
    );

    const requestParameters = new Map([
      ["method", "HttpVerb"],
      ["options", "Options"],
    ] as const);
    const preservedReferences = new Set<string>();

    for (const reflection of Object.values(project.reflections)) {
      if (!reflection.isParameter()) {
        continue;
      }

      const typeName = requestParameters.get(
        reflection.name as "method" | "options",
      );
      if (!typeName || reflection.parent?.parent?.name !== "request") {
        continue;
      }

      const target = publicTypes.get(typeName);
      if (!target) {
        throw new Error(`TypeDoc could not resolve ${typeName}`);
      }
      reflection.type = ReferenceType.createResolvedReference(
        typeName,
        target,
        project,
      );
      preservedReferences.add(reflection.name);
    }

    for (const parameterName of requestParameters.keys()) {
      if (!preservedReferences.has(parameterName)) {
        throw new Error(
          `TypeDoc could not preserve the request ${parameterName} type reference`,
        );
      }
    }
  });
}
