import { useState } from 'react';
import { Button, Input, Label, Spinner } from '@librechat/client';
import { useCreateAdminUserMutation, useInviteAdminUserMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function Users() {
  const localize = useLocalize();
  const [createEmail, setCreateEmail] = useState('');
  const [createName, setCreateName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<'USER' | 'ADMIN'>('USER');
  const [inviteEmail, setInviteEmail] = useState('');

  const createMutation = useCreateAdminUserMutation();
  const inviteMutation = useInviteAdminUserMutation();

  const handleCreate = () => {
    if (!createEmail) {
      return;
    }
    createMutation.mutate(
      {
        email: createEmail,
        name: createName || undefined,
        password: createPassword || undefined,
        role: createRole,
      },
      {
        onSuccess: () => {
          setCreateEmail('');
          setCreateName('');
          setCreatePassword('');
          setCreateRole('USER');
        },
      },
    );
  };

  const handleInvite = () => {
    if (!inviteEmail) {
      return;
    }
    inviteMutation.mutate(inviteEmail, { onSuccess: () => setInviteEmail('') });
  };

  return (
    <section className="rounded-xl border border-border-light bg-surface-secondary p-5">
      <h2 className="mb-4 text-lg font-medium text-text-primary">
        {localize('com_ui_kb_users_title')}
      </h2>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-primary">
            {localize('com_ui_kb_create_user')}
          </h3>
          <div className="space-y-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="kb-create-email" className="text-sm text-text-secondary">
                {localize('com_auth_email')}
              </Label>
              <Input
                id="kb-create-email"
                type="email"
                value={createEmail}
                onChange={(event) => setCreateEmail(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="kb-create-name" className="text-sm text-text-secondary">
                {localize('com_ui_name')}
              </Label>
              <Input
                id="kb-create-name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="kb-create-password" className="text-sm text-text-secondary">
                {localize('com_auth_password')}
              </Label>
              <Input
                id="kb-create-password"
                type="password"
                value={createPassword}
                onChange={(event) => setCreatePassword(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="kb-create-role" className="text-sm text-text-secondary">
                {localize('com_ui_role')}
              </Label>
              <select
                id="kb-create-role"
                className="rounded-md border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary"
                value={createRole}
                onChange={(event) => setCreateRole(event.target.value as 'USER' | 'ADMIN')}
              >
                <option value="USER">USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </div>
          </div>
          <Button variant="default" disabled={createMutation.isLoading} onClick={handleCreate}>
            {createMutation.isLoading ? <Spinner className="mr-2 size-4" /> : null}
            {localize('com_ui_kb_create_user')}
          </Button>
          {createMutation.isSuccess && (
            <p className="text-sm text-green-600 dark:text-green-400">
              {localize('com_ui_kb_user_created')}
            </p>
          )}
          {createMutation.isError && (
            <p className="text-sm text-red-500">{(createMutation.error as Error).message}</p>
          )}
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-primary">
            {localize('com_ui_kb_invite_user')}
          </h3>
          <div className="flex flex-col gap-1">
            <Label htmlFor="kb-invite-email" className="text-sm text-text-secondary">
              {localize('com_auth_email')}
            </Label>
            <Input
              id="kb-invite-email"
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
            />
          </div>
          <Button variant="default" disabled={inviteMutation.isLoading} onClick={handleInvite}>
            {inviteMutation.isLoading ? <Spinner className="mr-2 size-4" /> : null}
            {localize('com_ui_kb_invite_user')}
          </Button>
          {inviteMutation.data != null && (
            <div className="space-y-1 text-sm">
              {inviteMutation.data.emailSent && (
                <p className="text-green-600 dark:text-green-400">
                  {localize('com_ui_kb_email_sent')}
                </p>
              )}
              <p className="text-text-secondary">{localize('com_ui_kb_invite_link')}:</p>
              <code className="block break-all rounded-md bg-surface-tertiary p-2 text-xs text-text-primary">
                {inviteMutation.data.inviteLink}
              </code>
            </div>
          )}
          {inviteMutation.isError && (
            <p className="text-sm text-red-500">{(inviteMutation.error as Error).message}</p>
          )}
        </div>
      </div>
    </section>
  );
}
