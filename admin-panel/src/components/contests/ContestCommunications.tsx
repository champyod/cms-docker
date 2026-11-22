'use client';

import { SurfaceLoadState } from '@/components/core/SurfaceLoadState';
import { useDictionary } from '@/hooks/useDictionary';
import { useContestCommunications, type CommTab } from './contest-communications/useContestCommunications';
import { AnnouncementsPanel, type AnnouncementRow } from './contest-communications/AnnouncementsPanel';
import { QuestionsPanel, type QuestionRow } from './contest-communications/QuestionsPanel';

interface ContestCommunicationsProps {
  contestId: number;
  adminId: number;
  permissionKeys?: readonly string[];
  panel: CommTab;
}

/**
 * One of the contest's two message lists: announcements, or questions and their replies.
 *
 * Why one panel per instance: the page renders a board with a section per record kind, and a
 * component that also switched between the two would paint a second tab rail inside a section that
 * already has a heading. The card frame and the heading belong to the board, so only the panel
 * itself is rendered here.
 */
export function ContestCommunications({ contestId, adminId, permissionKeys = [], panel }: ContestCommunicationsProps): React.JSX.Element {
  const dict = useDictionary();
  const { reload, status, announcements, questions, showAnnouncementForm, announcementSubject, announcementText, replyingTo, replySubject, replyText, replySettled, setShowAnnouncementForm, setAnnouncementSubject, setAnnouncementText, setReplyingTo, setReplySubject, setReplyText, setReplySettled, handleCreateAnnouncement, handleDeleteAnnouncement, handleReply, handleIgnore } = useContestCommunications(contestId, adminId, panel);

  if (status.kind !== 'idle') {
    return (
      <SurfaceLoadState
        status={status}
        loadingTitle="Loading..."
        onRetry={reload}
        retryLabel={dict.states.retry.label}
      />
    );
  }
  return panel === 'announcements' ? (
    <AnnouncementsPanel announcements={announcements as AnnouncementRow[]} showForm={showAnnouncementForm} subject={announcementSubject} text={announcementText} permissionKeys={permissionKeys} onShowForm={setShowAnnouncementForm} onSubject={setAnnouncementSubject} onText={setAnnouncementText} onCreate={handleCreateAnnouncement} onDelete={handleDeleteAnnouncement} />
  ) : (
    <QuestionsPanel questions={questions as QuestionRow[]} replyingTo={replyingTo} replySubject={replySubject} replyText={replyText} replySettled={replySettled} permissionKeys={permissionKeys} onReplyingTo={setReplyingTo} onReplySubject={setReplySubject} onReplyText={setReplyText} onReplySettled={setReplySettled} onReply={handleReply} onIgnore={handleIgnore} />
  );
}
