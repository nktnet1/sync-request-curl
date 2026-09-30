import { OptionDefaults, type TypeDocOptions } from "typedoc";
import {
  type PluginOptions,
  load as typedocPluginMarkdown,
} from "typedoc-plugin-markdown";
import { EXTERNAL_TYPE_LINKS } from "#typedoc/externalLinks";
import { linkExternalTypes } from "#typedoc/plugins/linkExternalTypeReferences";
import { normalizeTypeSignatureFormatting } from "#typedoc/plugins/normalizeTypeSignatureFormatting";
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
    linkExternalTypes,
    preserveOptionsReference,
    normalizeTypeSignatureFormatting,
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
  blockTags: [...OptionDefaults.blockTags, "@noInheritDoc"],
  notRenderedTags: [...OptionDefaults.notRenderedTags, "@noInheritDoc"],
  sort: ["source-order"],
  externalSymbolLinkMappings: {
    "@types/node": {
      Agent: EXTERNAL_TYPE_LINKS.Agent,
      Blob: EXTERNAL_TYPE_LINKS.Blob,
      Buffer: EXTERNAL_TYPE_LINKS.Buffer,
      IncomingHttpHeaders: EXTERNAL_TYPE_LINKS.IncomingHttpHeaders,
      URL: EXTERNAL_TYPE_LINKS.URL,
    },
    typescript: {
      Error: EXTERNAL_TYPE_LINKS.Error,
      ErrorOptions: EXTERNAL_TYPE_LINKS.ErrorOptions,
    },
  },
} satisfies TypeDocOptions & PluginOptions;

export default config;
