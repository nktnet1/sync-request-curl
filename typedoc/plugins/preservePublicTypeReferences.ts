import {
  type Application,
  Converter,
  type ProjectReflection,
  ReferenceType,
  type Reflection,
  ReflectionKind,
} from "typedoc";

const PUBLIC_TYPE_NAMES = ["Headers", "HttpVerb", "Options"] as const;
type PublicTypeName = (typeof PUBLIC_TYPE_NAMES)[number];
type TypeDocProject = ProjectReflection;
type PublicTypes = Record<PublicTypeName, Reflection>;

const REQUEST_PARAMETERS = new Map([
  ["method", "HttpVerb"],
  ["options", "Options"],
] as const);

function findPublicType(
  project: TypeDocProject,
  name: PublicTypeName,
): Reflection {
  const reflection = Object.values(project.reflections).find(
    (candidate) =>
      candidate.name === name &&
      candidate.isDeclaration() &&
      !candidate.isReference() &&
      candidate.kindOf([ReflectionKind.Interface, ReflectionKind.TypeAlias]),
  );

  if (!reflection) {
    throw new Error(`TypeDoc could not find the public ${name} reflection`);
  }
  return reflection;
}

function collectPublicTypes(project: TypeDocProject): PublicTypes {
  return Object.fromEntries(
    PUBLIC_TYPE_NAMES.map((name) => [name, findPublicType(project, name)]),
  ) as PublicTypes;
}

function preserveHeadersReferences(
  project: TypeDocProject,
  headersType: Reflection,
): void {
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
}

function preserveRequestParameterReferences(
  project: TypeDocProject,
  publicTypes: PublicTypes,
): void {
  const preservedReferences = new Set<string>();

  for (const reflection of Object.values(project.reflections)) {
    if (!reflection.isParameter()) {
      continue;
    }

    const typeName = REQUEST_PARAMETERS.get(
      reflection.name as "method" | "options",
    );
    if (!typeName || reflection.parent?.parent?.name !== "request") {
      continue;
    }

    reflection.type = ReferenceType.createResolvedReference(
      typeName,
      publicTypes[typeName],
      project,
    );
    preservedReferences.add(reflection.name);
  }

  for (const parameterName of REQUEST_PARAMETERS.keys()) {
    if (!preservedReferences.has(parameterName)) {
      throw new Error(
        `TypeDoc could not preserve the request ${parameterName} type reference`,
      );
    }
  }
}

/**
 * Keep selected public API references linked to their named package types.
 * typedoc-plugin-valibot expands schema-derived types at reference sites, and
 * TypeDoc may otherwise inline aliases or resolve them to external target types.
 */
export function preservePublicTypeReferences(app: Application): void {
  app.converter.on(Converter.EVENT_RESOLVE_END, ({ project }) => {
    if (!project) {
      throw new Error("TypeDoc project is unavailable during resolution");
    }

    const publicTypes = collectPublicTypes(project);

    preserveHeadersReferences(project, publicTypes.Headers);
    preserveRequestParameterReferences(project, publicTypes);
  });
}
