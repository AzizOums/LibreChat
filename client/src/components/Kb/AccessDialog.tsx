import { useState } from 'react';
import { PrincipalType } from 'librechat-data-provider';
import { useSearchPrincipalsQuery } from 'librechat-data-provider/react-query';
import {
  OGDialog,
  OGDialogTitle,
  OGDialogContent,
  Button,
  Input,
  Spinner,
} from '@librechat/client';
import type { TKbAccessPrincipal } from 'librechat-data-provider';
import {
  useKbDocumentAccessQuery,
  useKbGroupAccessMutation,
  useKbUserOverrideMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

interface AccessDialogProps {
  fileId: string | null;
  onClose: () => void;
}

function PrincipalRow({
  principal,
  children,
}: {
  principal: TKbAccessPrincipal;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border-light px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm text-text-primary">
          {principal.name ?? principal.principalId}
        </p>
        {principal.email != null && (
          <p className="truncate text-xs text-text-secondary">{principal.email}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export default function AccessDialog({ fileId, onClose }: AccessDialogProps) {
  const localize = useLocalize();
  const [search, setSearch] = useState('');
  const { data: access, isLoading } = useKbDocumentAccessQuery(fileId);
  const groupMutation = useKbGroupAccessMutation();
  const overrideMutation = useKbUserOverrideMutation();
  const { data: searchResults } = useSearchPrincipalsQuery({
    q: search,
    limit: 10,
    types: [PrincipalType.USER, PrincipalType.GROUP],
  });

  if (fileId == null) {
    return null;
  }

  const grantedGroupIds = new Set(access?.groups.map((group) => group.principalId) ?? []);
  const overriddenUserIds = new Set(access?.users.map((user) => user.principalId) ?? []);
  const candidates = (searchResults?.results ?? []).filter(
    (result) =>
      result.id != null &&
      !(result.type === PrincipalType.GROUP && grantedGroupIds.has(result.id)) &&
      !(result.type === PrincipalType.USER && overriddenUserIds.has(result.id)),
  );

  return (
    <OGDialog open={fileId != null} onOpenChange={(open) => (open ? null : onClose())}>
      <OGDialogContent className="max-h-[85vh] w-11/12 max-w-lg overflow-y-auto">
        <OGDialogTitle>{localize('com_ui_kb_access_title')}</OGDialogTitle>
        {isLoading && <Spinner className="size-5" />}
        {access != null && (
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-medium text-text-primary">
                {localize('com_ui_kb_groups')}
              </h3>
              <div className="space-y-2">
                {access.groups.length === 0 && access.users.length === 0 && (
                  <p className="text-sm text-text-secondary">
                    {localize('com_ui_kb_no_access_entries')}
                  </p>
                )}
                {access.groups.map((group) => (
                  <PrincipalRow key={group.principalId} principal={group}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={groupMutation.isLoading}
                      onClick={() =>
                        groupMutation.mutate({
                          fileId,
                          groupId: group.principalId,
                          grant: false,
                        })
                      }
                    >
                      {localize('com_ui_delete')}
                    </Button>
                  </PrincipalRow>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-text-primary">
                {localize('com_ui_kb_user_overrides')}
              </h3>
              <div className="space-y-2">
                {access.users.map((user) => (
                  <PrincipalRow key={user.principalId} principal={user}>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        user.deny
                          ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                          : 'bg-green-500/15 text-green-600 dark:text-green-400'
                      }`}
                    >
                      {user.deny ? localize('com_ui_kb_denied') : localize('com_ui_kb_allow')}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={overrideMutation.isLoading}
                      onClick={() =>
                        overrideMutation.mutate({
                          fileId,
                          userId: user.principalId,
                          action: user.deny ? 'allow' : 'deny',
                        })
                      }
                    >
                      {user.deny ? localize('com_ui_kb_allow') : localize('com_ui_kb_deny')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={overrideMutation.isLoading}
                      onClick={() =>
                        overrideMutation.mutate({
                          fileId,
                          userId: user.principalId,
                          action: 'remove',
                        })
                      }
                    >
                      {localize('com_ui_delete')}
                    </Button>
                  </PrincipalRow>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium text-text-primary">
                {localize('com_ui_kb_search_principals')}
              </h3>
              <Input
                value={search}
                placeholder={localize('com_ui_kb_search_principals')}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="mt-2 space-y-2">
                {candidates.map((candidate) => (
                  <div
                    key={`${candidate.type}-${candidate.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border-light px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-text-primary">{candidate.name}</p>
                      <p className="truncate text-xs text-text-secondary">
                        {candidate.type === PrincipalType.GROUP
                          ? localize('com_ui_kb_groups')
                          : (candidate.email ?? '')}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {candidate.type === PrincipalType.GROUP ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={groupMutation.isLoading}
                          onClick={() =>
                            groupMutation.mutate({
                              fileId,
                              groupId: candidate.id as string,
                              grant: true,
                            })
                          }
                        >
                          {localize('com_ui_kb_allow')}
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={overrideMutation.isLoading}
                            onClick={() =>
                              overrideMutation.mutate({
                                fileId,
                                userId: candidate.id as string,
                                action: 'allow',
                              })
                            }
                          >
                            {localize('com_ui_kb_allow')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={overrideMutation.isLoading}
                            onClick={() =>
                              overrideMutation.mutate({
                                fileId,
                                userId: candidate.id as string,
                                action: 'deny',
                              })
                            }
                          >
                            {localize('com_ui_kb_deny')}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </OGDialogContent>
    </OGDialog>
  );
}
