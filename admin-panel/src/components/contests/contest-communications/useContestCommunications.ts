'use client';

import { useState, useCallback } from 'react';
import { getAnnouncements, createAnnouncement, deleteAnnouncement } from '@/app/actions/announcements';
import { getQuestions, replyToQuestion, ignoreQuestion, unignoreQuestion } from '@/app/actions/questions';
import { useConfirm } from '@/hooks/useConfirm';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useDictionary } from '@/hooks/useDictionary';
import { surfaceLoadMessages, useSurfaceLoad } from '@/hooks/useSurfaceLoad';

// Why no ranking member: the board is its own contest tab now, because a scoreboard is
// not a message. It used to be a third tab here beside announcements and questions.
export type CommTab = 'announcements' | 'questions';

export function useContestCommunications(contestId: number, adminId: number) {
  const dict = useDictionary();
  const confirm = useConfirm();
  const { destructiveConfirm } = useConfirmationCopy();
  // Why: mutation actions throw on 403 — the feedback path toasts the denial
  // instead of leaving an unhandled rejection with no visible outcome.
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

  const load = useCallback(async (): Promise<void> => {
    if (activeTab === 'announcements') setAnnouncements(await getAnnouncements(contestId));
    else setQuestions(await getQuestions(contestId));
  }, [contestId, activeTab]);

  // Why the refusal is not swallowed any more: the load ran under a catch that only logged, so a
  // refused tab read as "no announcements" and "no questions". It now ends in data, denied or
  // failed, and the panel renders that; a tab switch re-runs the load for the tab it opened.
  const { status, reload } = useSurfaceLoad(load, surfaceLoadMessages(dict));

  const selectTab = useCallback((tab: CommTab): void => {
    setActiveTab(tab);
    reload();
  }, [reload]);

  const handleCreateAnnouncement = async (): Promise<void> => {
    if (!announcementSubject.trim() || !announcementText.trim()) return;
    const result = await runAction(
      { pending: 'Publishing announcement...', success: 'Announcement published', failure: 'Publish failed' },
      () => createAnnouncement(contestId, adminId, { subject: announcementSubject, text: announcementText }),
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
    if (!replySubject.trim() || !replyText.trim()) return;
    const result = await runAction(
      { pending: 'Sending reply...', success: 'Reply sent', failure: 'Reply failed' },
      () => replyToQuestion(questionId, adminId, { reply_subject: replySubject, reply_text: replyText }),
    );
    if (!result?.success) return;
    setReplyingTo(null);
    setReplySubject('');
    setReplyText('');
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
    replyingTo, setReplyingTo, replySubject, setReplySubject, replyText, setReplyText,
    reload, handleCreateAnnouncement, handleDeleteAnnouncement, handleReply, handleIgnore,
  };
}
