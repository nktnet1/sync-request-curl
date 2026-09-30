import {
  type Application,
  Converter,
  ReferenceType,
  ReflectionKind,
} from "typedoc";

/**
 * Keep selected public API references linked to their named package types.
 * typedoc-plugin-valibot expands schema-derived types at reference sites, and
 * TypeDoc may otherwise inline aliases or resolve them to external target types.
 */
export function preservePublicTypeReferences(app: Application): void {
  app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    const { project } = context;
    const publicTypes = new Map(
      ["Headers", "HttpVerb", "Options"].map((name) => {
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

    const headersType = publicTypes.get("Headers");
    if (!headersType) {
      throw new Error("TypeDoc could not resolve Headers");
    }

    for (const reflection of Object.values(project.reflections)) {
      if (reflection === headersType || !("type" in reflection)) {
        continue;
      }

      const reflectionType = reflection.type;
      if (
        reflectionType instanceof ReferenceType &&
        reflectionType.name === "IncomingHttpHeaders"
      ) {
        reflection.type = ReferenceType.createResolvedReference(
          "Headers",
          headersType,
          project,
        );
      }
    }

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
