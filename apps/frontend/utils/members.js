export function normalizeMemberEmail(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase();
}

export function availableProjectUsers(users, members, invitations) {
  const memberIds = new Set((members ?? []).map((member) => String(member.userId ?? '')));
  const memberEmails = new Set(
    (members ?? []).map((member) => normalizeMemberEmail(member.user?.email)).filter(Boolean),
  );
  const pendingEmails = new Set(
    (invitations ?? [])
      .filter((invitation) => invitation.status === 'pending')
      .map((invitation) => normalizeMemberEmail(invitation.email))
      .filter(Boolean),
  );

  return (users ?? []).filter((user) => {
    const email = normalizeMemberEmail(user.email);
    return (
      user.status === 'active' &&
      user.emailVerified === true &&
      !memberIds.has(String(user.id)) &&
      !memberEmails.has(email) &&
      !pendingEmails.has(email)
    );
  });
}

export function pendingProjectInvitations(invitations, members) {
  const memberEmails = new Set(
    (members ?? []).map((member) => normalizeMemberEmail(member.user?.email)).filter(Boolean),
  );
  return (invitations ?? []).filter(
    (invitation) =>
      invitation.status === 'pending' && !memberEmails.has(normalizeMemberEmail(invitation.email)),
  );
}
