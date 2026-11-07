import type * as prismic from "@prismicio/client";

type Simplify<T> = { [KeyType in keyof T]: T[KeyType] };


type PickContentRelationshipFieldData<
	TRelationship extends prismic.CustomTypeModelFetchCustomTypeLevel1 | prismic.CustomTypeModelFetchCustomTypeLevel2 | prismic.CustomTypeModelFetchGroupLevel1 | prismic.CustomTypeModelFetchGroupLevel2,
	TData extends Record<string, prismic.AnyRegularField | prismic.GroupField | prismic.NestedGroupField | prismic.SliceZone>,
	TLang extends string
> = |
	// Content relationship fields
	{
		[TSubRelationship in Extract<
			TRelationship["fields"][number], prismic.CustomTypeModelFetchContentRelationshipLevel1
		> as TSubRelationship["id"]]:
			ContentRelationshipFieldWithData<TSubRelationship["customtypes"], TLang>;
	} &
	// Group
	{
		[TGroup in Extract<
			TRelationship["fields"][number], prismic.CustomTypeModelFetchGroupLevel1 | prismic.CustomTypeModelFetchGroupLevel2
		> as TGroup["id"]]:
			TData[TGroup["id"]] extends prismic.GroupField<infer TGroupData>
				? prismic.GroupField<PickContentRelationshipFieldData<TGroup, TGroupData, TLang>>
				: never
	} &
	// Other fields
	{
		[TFieldKey in Extract<TRelationship["fields"][number], string>]:
			TFieldKey extends keyof TData ? TData[TFieldKey] : never;
	};

type ContentRelationshipFieldWithData<
	TCustomType extends readonly (prismic.CustomTypeModelFetchCustomTypeLevel1 | string)[] | readonly (prismic.CustomTypeModelFetchCustomTypeLevel2 | string)[],
	TLang extends string = string
> = {
	[ID in Exclude<TCustomType[number], string>["id"]]:
		prismic.ContentRelationshipField<
			ID,
			TLang,
			PickContentRelationshipFieldData<
				Extract<TCustomType[number], { id: ID }>,
				Extract<prismic.Content.AllDocumentTypes, { type: ID }>["data"],
				TLang
			>
		>
}[Exclude<TCustomType[number], string>["id"]];

/**
 * Item in *Curated Link → Tags*
 */
export interface CuratedLinkDocumentDataTopicsItem {
	/**
	 * Topic field in *Curated Link → Tags*
	 *
	 * - **Field Type**: Content Relationship
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.topics[].topic
	 * - **Documentation**: https://prismic.io/docs/fields/content-relationship
	 */
	topic: prismic.ContentRelationshipField<"topic">;
}

/**
 * Content for Curated Link documents
 */
interface CuratedLinkDocumentData {
	/**
	 * Title field in *Curated Link*
	 *
	 * - **Field Type**: Rich Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.title
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/rich-text
	 */
	title: prismic.RichTextField;
	
	/**
	 * Summary field in *Curated Link*
	 *
	 * - **Field Type**: Rich Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.summary
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/rich-text
	 */
	summary: prismic.RichTextField;
	
	/**
	 * Url field in *Curated Link*
	 *
	 * - **Field Type**: Link
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.url
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/link
	 */
	url: prismic.LinkField<string, string, unknown, prismic.FieldState, never>;
	
	/**
	 * Selected On field in *Curated Link*
	 *
	 * - **Field Type**: Date
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.selected_on
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/date
	 */
	selected_on: prismic.DateField;
	
	/**
	 * Published On field in *Curated Link*
	 *
	 * - **Field Type**: Date
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.published_on
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/date
	 */
	published_on: prismic.DateField;
	
	/**
	 * Format field in *Curated Link*
	 *
	 * - **Field Type**: Select
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.format
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/select
	 */
	format: prismic.SelectField<"Article" | "Video" | "Repository" | "Release" | "Documentation" | "Tool" | "Other">;
	
	/**
	 * Credit field in *Curated Link*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.credit
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/text
	 */
	credit: prismic.KeyTextField;
	
	/**
	 * Discovered Via field in *Curated Link*
	 *
	 * - **Field Type**: Content Relationship
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.discovered_via
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/content-relationship
	 */
	discovered_via: prismic.ContentRelationshipField<"discovery_source">;
	
	/**
	 * Tags field in *Curated Link*
	 *
	 * - **Field Type**: Group
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.topics[]
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/repeatable-group
	 */
	topics: prismic.GroupField<Simplify<CuratedLinkDocumentDataTopicsItem>>;
	
	/**
	 * Image field in *Curated Link*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.image
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/image
	 */
	image: prismic.ImageField<never>;
	
	/**
	 * Site Icon field in *Curated Link*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.site_icon
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/image
	 */
	site_icon: prismic.ImageField<never>;
	
	/**
	 * Source Language field in *Curated Link*
	 *
	 * - **Field Type**: Select
	 * - **Placeholder**: *None*
	 * - **API ID Path**: curated_link.source_language
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/select
	 */
	source_language: prismic.SelectField<"EN" | "FR">;
}

/**
 * Curated Link document from Prismic
 *
 * - **API ID**: `curated_link`
 * - **Repeatable**: `true`
 * - **Documentation**: https://prismic.io/docs/content-modeling
 *
 * @typeParam Lang - Language API ID of the document.
 */
export type CuratedLinkDocument<Lang extends string = string> = prismic.PrismicDocumentWithUID<Simplify<CuratedLinkDocumentData>, "curated_link", Lang>;

/**
 * Content for Discovery Source documents
 */
interface DiscoverySourceDocumentData {
	/**
	 * Name field in *Discovery Source*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: discovery_source.name
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/text
	 */
	name: prismic.KeyTextField;
	
	/**
	 * Url field in *Discovery Source*
	 *
	 * - **Field Type**: Link
	 * - **Placeholder**: *None*
	 * - **API ID Path**: discovery_source.url
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/link
	 */
	url: prismic.LinkField<string, string, unknown, prismic.FieldState, never>;
	
	/**
	 * Icon field in *Discovery Source*
	 *
	 * - **Field Type**: Image
	 * - **Placeholder**: *None*
	 * - **API ID Path**: discovery_source.icon
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/image
	 */
	icon: prismic.ImageField<never>;
}

/**
 * Discovery Source document from Prismic
 *
 * - **API ID**: `discovery_source`
 * - **Repeatable**: `true`
 * - **Documentation**: https://prismic.io/docs/content-modeling
 *
 * @typeParam Lang - Language API ID of the document.
 */
export type DiscoverySourceDocument<Lang extends string = string> = prismic.PrismicDocumentWithUID<Simplify<DiscoverySourceDocumentData>, "discovery_source", Lang>;

/**
 * Item in *Tags → Aliases*
 */
export interface TopicDocumentDataAliasesItem {
	/**
	 * Alias field in *Tags → Aliases*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: topic.aliases[].alias
	 * - **Documentation**: https://prismic.io/docs/fields/text
	 */
	alias: prismic.KeyTextField;
}

/**
 * Item in *Tags → Related tags*
 */
export interface TopicDocumentDataRelatedTagsItem {
	/**
	 * Tag field in *Tags → Related tags*
	 *
	 * - **Field Type**: Content Relationship
	 * - **Placeholder**: *None*
	 * - **API ID Path**: topic.related_tags[].tag
	 * - **Documentation**: https://prismic.io/docs/fields/content-relationship
	 */
	tag: prismic.ContentRelationshipField<"topic">;
}

/**
 * Content for Tags documents
 */
interface TopicDocumentData {
	/**
	 * Name field in *Tags*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: topic.name
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/text
	 */
	name: prismic.KeyTextField;
	
	/**
	 * Description field in *Tags*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: topic.description
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/text
	 */
	description: prismic.KeyTextField;
	
	/**
	 * Category field in *Tags*
	 *
	 * - **Field Type**: Select
	 * - **Placeholder**: *None*
	 * - **API ID Path**: topic.category
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/select
	 */
	category: prismic.SelectField<"language" | "framework-library" | "tool-application" | "platform-infrastructure" | "standard-api-format" | "concept-technique" | "practice-method" | "domain-use-case">;
	
	/**
	 * Status field in *Tags*
	 *
	 * - **Field Type**: Select
	 * - **Placeholder**: *None*
	 * - **Default Value**: active
	 * - **API ID Path**: topic.status
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/select
	 */
	status: prismic.SelectField<"active" | "retired", "filled">;
	
	/**
	 * Highlighted field in *Tags*
	 *
	 * - **Field Type**: Boolean
	 * - **Placeholder**: *None*
	 * - **Default Value**: false
	 * - **API ID Path**: topic.highlighted
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/boolean
	 */
	highlighted: prismic.BooleanField;
	
	/**
	 * Preserve existing page field in *Tags*
	 *
	 * - **Field Type**: Boolean
	 * - **Placeholder**: *None*
	 * - **Default Value**: false
	 * - **API ID Path**: topic.legacy_page
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/boolean
	 */
	legacy_page: prismic.BooleanField;
	
	/**
	 * Aliases field in *Tags*
	 *
	 * - **Field Type**: Group
	 * - **Placeholder**: *None*
	 * - **API ID Path**: topic.aliases[]
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/repeatable-group
	 */
	aliases: prismic.GroupField<Simplify<TopicDocumentDataAliasesItem>>;
	
	/**
	 * Related tags field in *Tags*
	 *
	 * - **Field Type**: Group
	 * - **Placeholder**: *None*
	 * - **API ID Path**: topic.related_tags[]
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/repeatable-group
	 */
	related_tags: prismic.GroupField<Simplify<TopicDocumentDataRelatedTagsItem>>;
	
	/**
	 * SEO title field in *Tags*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: topic.seo_title
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/text
	 */
	seo_title: prismic.KeyTextField;
	
	/**
	 * SEO description field in *Tags*
	 *
	 * - **Field Type**: Text
	 * - **Placeholder**: *None*
	 * - **API ID Path**: topic.seo_description
	 * - **Tab**: Main
	 * - **Documentation**: https://prismic.io/docs/fields/text
	 */
	seo_description: prismic.KeyTextField;
}

/**
 * Tags document from Prismic
 *
 * - **API ID**: `topic`
 * - **Repeatable**: `true`
 * - **Documentation**: https://prismic.io/docs/content-modeling
 *
 * @typeParam Lang - Language API ID of the document.
 */
export type TopicDocument<Lang extends string = string> = prismic.PrismicDocumentWithUID<Simplify<TopicDocumentData>, "topic", Lang>;

export type AllDocumentTypes = CuratedLinkDocument | DiscoverySourceDocument | TopicDocument;

declare module "@prismicio/client" {
	interface CreateClient {
		(repositoryNameOrEndpoint: string, options?: prismic.ClientConfig): prismic.Client<AllDocumentTypes>;
	}
	
	interface CreateWriteClient {
		(repositoryNameOrEndpoint: string, options: prismic.WriteClientConfig): prismic.WriteClient<AllDocumentTypes>;
	}
	
	interface CreateMigration {
		(): prismic.Migration<AllDocumentTypes>;
	}
	
	namespace Content {
		export type {
			CuratedLinkDocument,
			CuratedLinkDocumentData,
			CuratedLinkDocumentDataTopicsItem,
			DiscoverySourceDocument,
			DiscoverySourceDocumentData,
			TopicDocument,
			TopicDocumentData,
			TopicDocumentDataAliasesItem,
			TopicDocumentDataRelatedTagsItem,
			AllDocumentTypes
		}
	}
}