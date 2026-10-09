import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken } from '@/lib/auth/storage';
import {
  adminChatErrorMessage, fetchAdminChat, fetchAdminChats, INITIAL_ADMIN_CHAT_FILTERS,
  type AdminChatDetail, type AdminChatFilters, type AdminChatList,
} from '@/lib/api/adminChat';

/** Mounted only after the existing administrator gate has allowed access. */
export function useAIConversationReview(onAccessError: (error: unknown) => boolean) {
  const [filters, setFilters] = useState<AdminChatFilters>(INITIAL_ADMIN_CHAT_FILTERS);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<AdminChatList | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ id: string } | null>(null);
  const [detail, setDetail] = useState<AdminChatDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const accessError = useRef(onAccessError);
  accessError.current = onAccessError;

  const closeDetail = useCallback(() => {
    detailController.current?.abort();
    setSelection(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  const clearList = useCallback(() => {
    listController.current?.abort();
    closeDetail();
    setList(null);
    setListError(null);
    setListLoading(true);
  }, [closeDetail]);

  const applyFilters = useCallback((next: AdminChatFilters) => {
    clearList();
    setFilters({ ...next, q: next.q.trim(), reason: next.reason.trim() });
    setOffset(0);
    // Also reload when the same filters are submitted again.
    setRevision((value) => value + 1);
  }, [clearList]);

  const changePage = useCallback((next: number) => {
    clearList();
    setOffset(next);
  }, [clearList]);

  const refresh = useCallback(() => {
    clearList();
    setRevision((value) => value + 1);
  }, [clearList]);

  const select = useCallback((id: string) => {
    detailController.current?.abort();
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setSelection({ id });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const authToken = getToken();
    listController.current = controller;
    void fetchAdminChats(filters, offset, controller.signal).then((data) => {
      if (!controller.signal.aborted && authToken === getToken()) setList(data);
    }).catch((error: unknown) => {
      if (controller.signal.aborted || authToken !== getToken() || accessError.current(error)) return;
      setListError(adminChatErrorMessage(error));
    }).finally(() => {
      if (!controller.signal.aborted && authToken === getToken()) setListLoading(false);
    });
    return () => controller.abort();
  }, [filters, offset, revision]);

  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    const authToken = getToken();
    detailController.current = controller;
    void fetchAdminChat(selection.id, controller.signal).then((data) => {
      if (controller.signal.aborted || authToken !== getToken()) return;
      if (data.id !== selection.id) throw new Error('Chat review identifier mismatch');
      setDetail(data);
    }).catch((error: unknown) => {
      if (controller.signal.aborted || authToken !== getToken() || accessError.current(error)) return;
      setDetailError(adminChatErrorMessage(error, true));
    }).finally(() => {
      if (!controller.signal.aborted && authToken === getToken()) setDetailLoading(false);
    });
    return () => controller.abort();
  }, [selection]);

  return {
    filters, offset, list, listLoading, listError, selectedId: selection?.id ?? null,
    detail, detailLoading, detailError, applyFilters, changePage, refresh, select, closeDetail,
  };
}
