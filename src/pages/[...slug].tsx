import { ReactElement } from "react"
import { ParsedUrlQuery } from "querystring"
import { MDXRemote, type MDXRemoteSerializeResult } from "next-mdx-remote"
import { serverSideTranslations } from "next-i18next/serverSideTranslations"
import { serialize } from "next-mdx-remote/serialize"
import remarkGfm from "remark-gfm"
import { join } from "path"
import readingTime from "reading-time"

import { getContent, getContentBySlug } from "@/lib/utils/md"
import { getLastDeployDate } from "@/lib/utils/getLastDeployDate"
import { getLastModifiedDate } from "@/lib/utils/gh"
import rehypeImg from "@/lib/rehype/rehypeImg"
import rehypeHeadingIds from "@/lib/rehype/rehypeHeadingIds"

// Layouts and components
import {
  RootLayout,
  staticComponents,
  StaticLayout,
  useCasesComponents,
  UseCasesLayout,
  stakingComponents,
  StakingLayout,
  roadmapComponents,
  RoadmapLayout,
  upgradeComponents,
  UpgradeLayout,
  // docsComponents,
  // DocsLayout,
  tutorialsComponents,
  TutorialLayout,
} from "@/layouts"

import mdComponents from "@/components/MdComponents"
import PageMetadata from "@/components/PageMetadata"

// Types
import type { GetStaticPaths, GetStaticProps } from "next/types"
import type { NextPageWithLayout, StaticPaths } from "@/lib/types"
import { dateToString } from "@/lib/utils/date"
import { generateTableOfContents } from "@/lib/utils/toc"

const layoutMapping = {
  static: StaticLayout,
  "use-cases": UseCasesLayout,
  staking: StakingLayout,
  roadmap: RoadmapLayout,
  upgrade: UpgradeLayout,
  tutorial: TutorialLayout,
  // event: EventLayout,
  // docs: DocsLayout,
} as const

const componentsMapping = {
  static: staticComponents,
  "use-cases": useCasesComponents,
  staking: stakingComponents,
  roadmap: roadmapComponents,
  upgrade: upgradeComponents,
  // docs: docsComponents,
  tutorial: tutorialsComponents,
} as const

interface Params extends ParsedUrlQuery {
  slug: string[]
}

interface Props {
  mdxSource: MDXRemoteSerializeResult
}

export const getStaticPaths: GetStaticPaths = ({ locales }) => {
  const contentFiles = getContent("/")

  let paths: StaticPaths = []

  // Generate page paths for each supported locale
  for (const locale of locales!) {
    contentFiles.map((file) => {
      paths.push({
        params: {
          // Splitting nested paths to generate proper slug
          slug: file.slug.split("/").slice(1),
        },
        locale,
      })
    })
  }

  return {
    paths,
    fallback: false,
  }
}

export const getStaticProps: GetStaticProps<Props, Params> = async (
  context
) => {
  const params = context.params!
  const { locale } = context

  const markdown = getContentBySlug(`${locale}/${params.slug.join("/")}`)
  const frontmatter = markdown.frontmatter
  const contentNotTranslated = markdown.contentNotTranslated

  const mdPath = join("/content", ...params.slug)
  const mdDir = join("public", mdPath)

  const mdxSource = await serialize(markdown.content, {
    mdxOptions: {
      // Required since MDX v2 to compile tables (see https://mdxjs.com/migrating/v2/#gfm)
      remarkPlugins: [remarkGfm],
      rehypePlugins: [
        [rehypeImg, { dir: mdDir, srcPath: mdPath, locale }],
        [rehypeHeadingIds],
      ],
    },
  })

  const timeToRead = readingTime(markdown.content)
  const tocItems = generateTableOfContents(mdxSource.compiledSource)
  const originalSlug = `/${params.slug.join("/")}/`
  const lastUpdatedDate = getLastModifiedDate(originalSlug, locale!)
  const lastDeployDate = getLastDeployDate()

  // Get corresponding layout
  let layout = frontmatter.template

  if (!frontmatter.template) {
    layout = "static"

    if (params.slug.includes("docs")) {
      layout = "docs"
    }

    if (params.slug.includes("tutorials")) {
      layout = "tutorial"
      if ("published" in frontmatter) {
        frontmatter.published = dateToString(frontmatter.published)
      }
    }
  }

  return {
    props: {
      ...(await serverSideTranslations(locale!, ["common"])), // load i18n required namespace for all pages
      mdxSource,
      originalSlug,
      frontmatter,
      lastUpdatedDate,
      lastDeployDate,
      contentNotTranslated,
      layout,
      timeToRead: Math.round(timeToRead.minutes),
      tocItems,
    },
  }
}

interface ContentPageProps extends Props {
  layout: keyof typeof layoutMapping
}

const ContentPage: NextPageWithLayout<ContentPageProps> = ({
  mdxSource,
  layout,
}) => {
  const components = { ...mdComponents, ...componentsMapping[layout] }
  return (
    <>
      {/* // TODO: fix components types, for some reason MDXRemote doesn't like some of them */}
      {/* @ts-ignore */}
      <MDXRemote {...mdxSource} components={components} />
    </>
  )
}

// Per-Page Layouts: https://nextjs.org/docs/pages/building-your-application/routing/pages-and-layouts#with-typescript
ContentPage.getLayout = (page: ReactElement) => {
  // values returned by `getStaticProps` method and passed to the page component
  const {
    originalSlug: slug,
    frontmatter,
    lastUpdatedDate,
    lastDeployDate,
    contentNotTranslated,
    layout,
    timeToRead,
    tocItems,
  } = page.props

  const rootLayoutProps = {
    contentIsOutdated: frontmatter.isOutdated,
    contentNotTranslated,
    lastDeployDate,
  }
  const layoutProps = {
    slug,
    frontmatter,
    lastUpdatedDate,
    timeToRead,
    tocItems,
  }
  const Layout = layoutMapping[layout]

  return (
    <RootLayout {...rootLayoutProps}>
      <Layout {...layoutProps}>
        <PageMetadata
          title={frontmatter.title}
          description={frontmatter.description}
          image={frontmatter.image}
          author={frontmatter.author}
          canonicalUrl={frontmatter.sourceUrl}
        />
        {page}
      </Layout>
    </RootLayout>
  )
}

export default ContentPage
