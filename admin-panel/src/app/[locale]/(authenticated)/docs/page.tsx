import { DocsContent } from '@/components/docs/DocsContent';
import { getDictionary } from '@/i18n';

export default async function DocsPage({ params }: { params: Promise<{ locale: string }> }): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);

  return <DocsContent title={dict.docs.title} subtitle={dict.docs.subtitle} officialDocsLabel={dict.docs.officialDocs} />;
}
