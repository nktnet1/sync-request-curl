import { type Application, Converter, ReflectionKind } from "typedoc";

export function removeEmptyTypeParameterLists(app: Application): void {
  app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    for (const reflection of Object.values(context.project.reflections)) {
      if (
        reflection.isDeclaration() &&
        reflection.kindOf(ReflectionKind.TypeAlias) &&
        reflection.typeParameters?.length === 0
      ) {
        reflection.typeParameters = undefined;
      }
    }
  });
}
