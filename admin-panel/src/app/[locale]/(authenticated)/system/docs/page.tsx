import { BoardPage, type BoardSection } from '@/components/patterns/BoardPage';
import docs from '@/components/docs/docs.json';
import { ContestsSection } from '@/components/docs/sections/ContestsSection';
import { ServicesSection } from '@/components/docs/sections/ServicesSection';
import { SubmissionsSection } from '@/components/docs/sections/SubmissionsSection';
import { TasksSection } from '@/components/docs/sections/TasksSection';
import { UsersSection } from '@/components/docs/sections/UsersSection';
import { getDictionary } from '@/i18n';

// Why a token: this page is declared, so it has to survive light, dark and high contrast, and a
// palette step looks the same in all of them.
const OFFICIAL_DOCS_LINK =
  'inline-flex min-h-11 items-center text-xs text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground';

/** What one topic covers, taken from the same list the page's sections are ordered by. */
function topicDetail(id: string): string | undefined {
  return docs.navigation.find((item) => item.id === id)?.detail;
}

/**
 * The panel's own reference, one section per record kind it documents.
 *
 * WHY a board: the page is five independent topics - contests, users, tasks, submissions, services -
 * and none of them is a record the reader acts on. A list would have had to invent rows, a filter
 * and a total; settings would have claimed the topics are preferences. The board is the layout that
 * holds several sections which each mean something on their own, and it renders the section
 * headings the page used to draw for itself.
 *
 * WHY the jump grid is gone: it listed the same five headings, in the same order, directly above the
 * headings the board now renders. The layout owns the section title and the link out, so the grid
 * had nothing left to add.
 */
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
      title={dict.navigation.system.docs.label}
      sections={sections}
    />
  );
}
