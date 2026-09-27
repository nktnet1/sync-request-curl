import { OptionDefaults, type TypeDocOptions } from "typedoc";
import {
  type PluginOptions,
  load as typedocPluginMarkdown,
} from "typedoc-plugin-markdown";
import { preserveOptionsReference } from "#typedoc/plugins/preserveOptionsReference";
import { removeEmptyTypeParameterLists } from "#typedoc/plugins/removeEmptyTypeParameterLists";
import { removeLeadingReturnUnionPipe } from "#typedoc/plugins/removeLeadingReturnUnionPipe";
import { removeTrailingWhitespace } from "#typedoc/plugins/removeTrailingWhitespace";
import { removeTypeAliasPropertyDefaults } from "#typedoc/plugins/removeTypeAliasPropertyDefaults";

const config = {
  plugin: [
    "typedoc-plugin-valibot",
    "typedoc-plugin-no-inherit",
    typedocPluginMarkdown,
    removeEmptyTypeParameterLists,
    preserveOptionsReference,
    removeTypeAliasPropertyDefaults,
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
  typeAliasPropertiesFormat: "list",
  expandObjects: true,
  useCodeBlocks: true,
  categorizeByGroup: false,
  groupOrder: ["Request", "Response", "Multipart", "Errors", "*"],
  groupReferencesByType: true,
  jsDocCompatibility: true,
  blockTags: [...OptionDefaults.blockTags, "@level", "@noInheritDoc"],
  notRenderedTags: [...OptionDefaults.notRenderedTags, "@noInheritDoc"],
  sort: ["source-order"],
} satisfies TypeDocOptions & PluginOptions;

export default config;
