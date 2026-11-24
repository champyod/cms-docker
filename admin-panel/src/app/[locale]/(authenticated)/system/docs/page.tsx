import { BoardPage, type BoardSection } from '@/components/patterns/BoardPage';
import docs from '@/components/docs/docs.json';
import { ContestsSection } from '@/components/docs/sections/ContestsSection';
import { ServicesSection } from '@/components/docs/sections/ServicesSection';
import { SubmissionsSection } from '@/components/docs/sections/SubmissionsSection';
import { TasksSection } from '@/components/docs/sections/TasksSection';
import { UsersSection } from '@/components/docs/sections/UsersSection';
import { getDictionary } from '@/i18n';

// A token survives light, dark and high contrast; a palette step does not.
const OFFICIAL_DOCS_LINK =
  'inline-flex min-h-11 items-center text-xs text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground';

/** What one topic covers, taken from the same list the page's sections are ordered by. */
function topicDetail(id: string): string | undefined {
  return docs.navigation.find((item) => item.id === id)?.detail;
}

export default async function SystemDocsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const officialDocs = (href: string): React.JSX.Element => (
    <a href={href} target="_blank" rel="noopener noreferrer" className={OFFICIAL_DOCS_LINK}>
      {dict.docs.officialDocs}
    </a>
  );
  const sections: readonly BoardSection[] = [
    {
      key: 'contests',
      title: docs.sections.contests.title,
      description: topicDetail('contests'),
      actions: officialDocs(docs.sections.contests.docsUrl),
      rows: <ContestsSection />,
    },
    {
      key: 'users',
      title: docs.sections.users.title,
      description: topicDetail('users'),
      actions: officialDocs(docs.sections.users.docsUrl),
      rows: <UsersSection />,
    },
    {
      key: 'tasks',
      title: docs.sections.tasks.title,
      description: topicDetail('tasks'),
      actions: officialDocs(docs.sections.tasks.docsUrl),
      rows: <TasksSection />,
    },
    {
      key: 'submissions',
      title: 'Submissions',
      description: topicDetail('submissions'),
      rows: <SubmissionsSection />,
    },
    {
      key: 'services',
      title: docs.sections.services.title,
      description: topicDetail('services'),
      actions: officialDocs(docs.sections.services.docsUrl),
      rows: <ServicesSection />,
    },
  ];
  return (
    <BoardPage
      // The system module shell above renders the title, the description and the trail.
      ownsHeader={false}
      sections={sections}
    />
  );
}
