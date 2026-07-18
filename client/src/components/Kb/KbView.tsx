import { Navigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { useLocalize, useAuthContext } from '~/hooks';
import Documents from './Documents';
import Upload from './Upload';
import Users from './Users';

export default function KbView() {
  const localize = useLocalize();
  const { user, isAuthenticated } = useAuthContext();

  if (isAuthenticated && user != null && user.role !== SystemRoles.ADMIN) {
    return <Navigate to="/c/new" replace={true} />;
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-surface-primary p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-10">
        <h1 className="text-2xl font-semibold text-text-primary">{localize('com_ui_kb_title')}</h1>
        <Upload />
        <Documents />
        <Users />
      </div>
    </div>
  );
}
