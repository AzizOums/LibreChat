/* Knowledge Base (admin) */
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type {
  TKbDocumentResponse,
  TAdminUserSummary,
  TAdminCreateUserRequest,
  TAdminInviteUserResponse,
} from 'librechat-data-provider';

function useInvalidateKbDocuments() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries([QueryKeys.kbDocuments]);
}

export const useUploadKbDocumentMutation = (): UseMutationResult<
  TKbDocumentResponse,
  Error,
  FormData
> => {
  const invalidate = useInvalidateKbDocuments();
  return useMutation((data: FormData) => dataService.uploadKbDocument(data), {
    onSuccess: invalidate,
  });
};

export const useDeleteKbDocumentMutation = (): UseMutationResult<
  { deleted: boolean; file_id: string },
  Error,
  string
> => {
  const invalidate = useInvalidateKbDocuments();
  return useMutation((fileId: string) => dataService.deleteKbDocument(fileId), {
    onSuccess: invalidate,
  });
};

export const useRetryKbDocumentMutation = (): UseMutationResult<
  TKbDocumentResponse,
  Error,
  string
> => {
  const invalidate = useInvalidateKbDocuments();
  return useMutation((fileId: string) => dataService.retryKbDocument(fileId), {
    onSuccess: invalidate,
  });
};

export type KbGroupAccessParams = { fileId: string; groupId: string; grant: boolean };
export const useKbGroupAccessMutation = (): UseMutationResult<
  unknown,
  Error,
  KbGroupAccessParams
> => {
  const queryClient = useQueryClient();
  return useMutation(
    async ({ fileId, groupId, grant }: KbGroupAccessParams): Promise<unknown> =>
      grant
        ? await dataService.setKbGroupAccess(fileId, groupId)
        : await dataService.removeKbGroupAccess(fileId, groupId),
    {
      onSuccess: (_data, { fileId }) => {
        queryClient.invalidateQueries([QueryKeys.kbDocumentAccess, fileId]);
      },
    },
  );
};

export type KbUserOverrideParams = {
  fileId: string;
  userId: string;
  action: 'allow' | 'deny' | 'remove';
};
export const useKbUserOverrideMutation = (): UseMutationResult<
  unknown,
  Error,
  KbUserOverrideParams
> => {
  const queryClient = useQueryClient();
  return useMutation(
    async ({ fileId, userId, action }: KbUserOverrideParams): Promise<unknown> =>
      action === 'remove'
        ? await dataService.removeKbUserOverride(fileId, userId)
        : await dataService.setKbUserOverride(fileId, userId, action === 'allow'),
    {
      onSuccess: (_data, { fileId }) => {
        queryClient.invalidateQueries([QueryKeys.kbDocumentAccess, fileId]);
      },
    },
  );
};

export const useCreateAdminUserMutation = (): UseMutationResult<
  { user: TAdminUserSummary },
  Error,
  TAdminCreateUserRequest
> => {
  return useMutation((payload: TAdminCreateUserRequest) => dataService.createAdminUser(payload));
};

export const useInviteAdminUserMutation = (): UseMutationResult<
  TAdminInviteUserResponse,
  Error,
  string
> => {
  return useMutation((email: string) => dataService.inviteAdminUser(email));
};
