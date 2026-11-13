import { describe, expect, it } from 'vitest';
import { availableProjectUsers, pendingProjectInvitations } from './members.js';

describe('project member selection', () => {
  it('only offers active, verified users without project access or an open invitation', () => {
    const users = [
      { id: 'owner', email: 'owner@example.com', status: 'active', emailVerified: true },
      { id: 'member', email: 'member@example.com', status: 'active', emailVerified: true },
      { id: 'pending', email: 'Pending@example.com', status: 'active', emailVerified: true },
      { id: 'blocked', email: 'blocked@example.com', status: 'blocked', emailVerified: true },
      { id: 'unverified', email: 'unverified@example.com', status: 'active', emailVerified: false },
      { id: 'available', email: 'available@example.com', status: 'active', emailVerified: true },
    ];
    const members = [
      { userId: 'owner', user: { email: 'owner@example.com' } },
      { userId: 'member', user: { email: 'member@example.com' } },
    ];
    const invitations = [{ email: ' pending@example.com ', status: 'pending' }];

    expect(availableProjectUsers(users, members, invitations).map((user) => user.id)).toEqual([
      'available',
    ]);
  });

  it('shows only pending invitations and removes invitees already listed as members', () => {
    const invitations = [
      { id: 'waiting', email: 'waiting@example.com', status: 'pending' },
      { id: 'accepted', email: 'accepted@example.com', status: 'accepted' },
      { id: 'revoked', email: 'revoked@example.com', status: 'revoked' },
      { id: 'expired', email: 'expired@example.com', status: 'expired' },
      { id: 'stale', email: 'STALE@example.com', status: 'pending' },
    ];
    const members = [{ userId: 'stale-user', user: { email: 'stale@example.com' } }];

    expect(pendingProjectInvitations(invitations, members)).toEqual([invitations[0]]);
  });
});
