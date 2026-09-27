import { OptionDefaults, type TypeDocOptions } from "typedoc";
import {
  type PluginOptions,
  load as typedocPluginMarkdown,
} from "typedoc-plugin-markdown";
import { removeEmptyTypeParameterLists } from "#typedoc/plugins/removeEmptyTypeParameterLists";
import { removeLeadingReturnUnionPipe } from "#typedoc/plugins/removeLeadingReturnUnionPipe";
import { removeTrailingWhitespace } from "#typedoc/plugins/removeTrailingWhitespace";

const config = {
  plugin: [
    typedocPluginMarkdown,
    removeEmptyTypeParameterLists,
    removeLeadingReturnUnionPipe,
    removeTrailingWhitespace,
  ],
  entryPoints: ["typedoc/api.ts"],
  readme: "none",
  gitRevision: "main",
  hidePageHeader: true,
  hidePageTitle: true,
  entryFileName: "README",
  fileExtension: ".md",
  cleanOutputDir: true,
  router: "module",
  disableSources: true,
  excludeInternal: true,
  typePrintWidth: 180,
  enumMembersFormat: "table",
  indexFormat: "table",
  interfacePropertiesFormat: "table",
  parametersFormat: "table",
  typeDeclarationFormat: "table",
  classPropertiesFormat: "table",
  propertyMembersFormat: "table",
  typeAliasPropertiesFormat: "table",
  expandObjects: true,
  useCodeBlocks: true,
  categorizeByGroup: false,
  groupOrder: ["Request", "Response", "Multipart", "Errors", "*"],
  groupReferencesByType: true,
  jsDocCompatibility: true,
  blockTags: [...OptionDefaults.blockTags, "@level"],
  sort: ["source-order"],
} satisfies TypeDocOptions & PluginOptions;

export default config;
