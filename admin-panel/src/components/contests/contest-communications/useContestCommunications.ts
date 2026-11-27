'use client';

import { useState, useCallback } from 'react';
import { getAnnouncements, createAnnouncement, deleteAnnouncement } from '@/app/actions/announcements';
import { getQuestions, replyToQuestion, ignoreQuestion, unignoreQuestion } from '@/app/actions/questions';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useDictionary } from '@/hooks/useDictionary';
import { surfaceLoadMessages, useSurfaceLoad } from '@/hooks/useSurfaceLoad';

// The board is its own tab: a scoreboard is not a message.
export type CommTab = 'announcements' | 'questions';

export function useContestCommunications(contestId: number) {
  const dict = useDictionary();
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  // Mutation actions throw on 403; the feedback path turns that into a visible toast.
  const runAction = useActionFeedback();
  const [activeTab, setActiveTab] = useState<CommTab>('announcements');
  const [announcements, setAnnouncements] = useState<unknown[]>([]);
  const [questions, setQuestions] = useState<unknown[]>([]);
  const [showAnnouncementForm, setShowAnnouncementForm] = useState(false);
  const [announcementSubject, setAnnouncementSubject] = useState('');
  const [announcementText, setAnnouncementText] = useState('');
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replySubject, setReplySubject] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replySettled, setReplySettled] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (activeTab === 'announcements') setAnnouncements(await getAnnouncements(contestId));
    else setQuestions(await getQuestions(contestId));
  }, [contestId, activeTab]);

  // A refusal ends in denied, never in an empty tab that reads as "nothing published".
  const { status, reload } = useSurfaceLoad(load, surfaceLoadMessages(dict));

  const selectTab = useCallback((tab: CommTab): void => {
    setActiveTab(tab);
    reload();
  }, [reload]);

  const handleCreateAnnouncement = async (): Promise<void> => {
    if (!announcementSubject.trim() || !announcementText.trim()) return;
    const result = await runAction(
      { pending: 'Publishing announcement...', success: 'Announcement published', failure: 'Publish failed' },
      () => createAnnouncement(contestId, { subject: announcementSubject, text: announcementText }),
    );
    if (!result?.success) return;
    setShowAnnouncementForm(false);
    setAnnouncementSubject('');
    setAnnouncementText('');
    reload();
  };

  const handleDeleteAnnouncement = async (id: number): Promise<void> => {
    if (!(await confirm(destructiveConfirm('announcement')))) return;
    const result = await runAction(
      { pending: 'Deleting announcement...', success: 'Announcement deleted', failure: 'Delete failed' },
      () => deleteAnnouncement(id),
    );
    if (result?.success) reload();
  };

  const handleReply = async (questionId: number): Promise<void> => {
    // The marker alone is a legal send: a statement answer has no body to write.
    if (!replySettled && (!replySubject.trim() || !replyText.trim())) return;
    const result = await runAction(
      { pending: 'Sending reply...', success: 'Reply sent', failure: 'Reply failed' },
      () => replyToQuestion(questionId, {
        reply_subject: replySubject,
        reply_text: replyText,
        resolution_kind: replySettled ? 'settled_by_statement' : undefined,
      }),
    );
    if (!result?.success) return;
    setReplyingTo(null);
    setReplySubject('');
    setReplyText('');
    setReplySettled(false);
    reload();
  };

  const handleIgnore = async (questionId: number, ignored: boolean): Promise<void> => {
    const result = await runAction(
      { pending: ignored ? 'Unignoring question...' : 'Ignoring question...', success: 'Question updated', failure: 'Update failed' },
      () => (ignored ? unignoreQuestion(questionId) : ignoreQuestion(questionId)),
    );
    if (result?.success) reload();
  };

  return {
    activeTab, selectTab, announcements, questions, status,
    showAnnouncementForm, setShowAnnouncementForm,
    announcementSubject, setAnnouncementSubject, announcementText, setAnnouncementText,
    replyingTo, setReplyingTo, replySubject, setReplySubject, replyText, setReplyText, replySettled, setReplySettled,
    reload, handleCreateAnnouncement, handleDeleteAnnouncement, handleReply, handleIgnore,
  };
}
