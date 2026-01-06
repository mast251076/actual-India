import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { isAdmin } from './account-db';
import * as UserService from './services/user-service';
import {
  errorMiddleware,
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from './util/middlewares';
import { validateSession } from './util/validate-user';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLoggerMiddleware);

export { app as handlers };

app.get('/owner-created/', async (req, res) => {
  try {
    const ownerCount = await UserService.getOwnerCount();
    res.json(ownerCount > 0);
  } catch {
    res.status(500).json({ error: 'Failed to retrieve owner count' });
  }
});

app.get('/users/', validateSessionMiddleware, async (req, res) => {
  const users = await UserService.getAllUsers();
  res.json(
    users.map(u => ({
      ...u,
      owner: u.owner === 1,
      enabled: u.enabled === 1,
    })),
  );
});

app.post('/users', validateSessionMiddleware, async (req, res) => {
  if (!(await isAdmin(res.locals.user_id))) {
    res.status(403).send({
      status: 'error',
      reason: 'forbidden',
      details: 'permission-not-found',
    });
    return;
  }

  const { userName, role, displayName, enabled } = req.body || {};

  if (!userName || !role) {
    res.status(400).send({
      status: 'error',
      reason: `${!userName ? 'user-cant-be-empty' : 'role-cant-be-empty'}`,
      details: `${!userName ? 'Username' : 'Role'} cannot be empty`,
    });
    return;
  }

  const roleIdFromDb = UserService.validateRole(role);
  if (!roleIdFromDb) {
    res.status(400).send({
      status: 'error',
      reason: 'role-does-not-exists',
      details: 'Selected role does not exist',
    });
    return;
  }

  const userIdInDb = await UserService.getUserByUsername(userName);
  if (userIdInDb) {
    res.status(400).send({
      status: 'error',
      reason: 'user-already-exists',
      details: `User ${userName} already exists`,
    });
    return;
  }

  const userId = uuidv4();
  await UserService.insertUser(
    userId,
    userName,
    displayName || null,
    enabled ? 1 : 0,
    role,
  );

  res.status(200).send({ status: 'ok', data: { id: userId } });
});

app.patch('/users', validateSessionMiddleware, async (req, res) => {
  if (!(await isAdmin(res.locals.user_id))) {
    res.status(403).send({
      status: 'error',
      reason: 'forbidden',
      details: 'permission-not-found',
    });
    return;
  }

  const { id, userName, role, displayName, enabled } = req.body || {};

  if (!userName || !role) {
    res.status(400).send({
      status: 'error',
      reason: `${!userName ? 'user-cant-be-empty' : 'role-cant-be-empty'}`,
      details: `${!userName ? 'Username' : 'Role'} cannot be empty`,
    });
    return;
  }

  const roleIdFromDb = UserService.validateRole(role);
  if (!roleIdFromDb) {
    res.status(400).send({
      status: 'error',
      reason: 'role-does-not-exists',
      details: 'Selected role does not exist',
    });
    return;
  }

  const userIdInDb = await UserService.getUserById(id);
  if (!userIdInDb) {
    res.status(400).send({
      status: 'error',
      reason: 'cannot-find-user-to-update',
      details: `Cannot find user ${userName} to update`,
    });
    return;
  }

  await UserService.updateUserWithRole(
    userIdInDb,
    userName,
    displayName || null,
    enabled ? 1 : 0,
    role,
  );

  res.status(200).send({ status: 'ok', data: { id: userIdInDb } });
});

app.delete('/users', validateSessionMiddleware, async (req, res) => {
  if (!(await isAdmin(res.locals.user_id))) {
    res.status(403).send({
      status: 'error',
      reason: 'forbidden',
      details: 'permission-not-found',
    });
    return;
  }

  const { ids } = req.body || {};
  let totalDeleted = 0;
  const ownerId = await UserService.getOwnerId();

  for (const item of ids) {
    if (item === ownerId) continue;

    await UserService.deleteUserAccess(item);
    await UserService.transferAllFilesFromUser(ownerId, item);
    const usersDeleted = await UserService.deleteUser(item);
    totalDeleted += usersDeleted;
  }

  if (ids.length === totalDeleted) {
    res
      .status(200)
      .send({ status: 'ok', data: { someDeletionsFailed: false } });
  } else {
    res.status(400).send({
      status: 'error',
      reason: 'not-all-deleted',
      details: '',
    });
  }
});

app.get('/access', validateSessionMiddleware, async (req, res) => {
  const fileId = req.query.fileId;

  const { granted } = (await UserService.checkFilePermission(
    fileId,
    res.locals.user_id,
  )) || {
    granted: 0,
  };

  if (granted === 0 && !(await isAdmin(res.locals.user_id))) {
    res.status(403).send({
      status: 'error',
      reason: 'forbidden',
      details: 'permission-not-found',
    });
    return;
  }

  const fileIdInDb = await UserService.getFileById(fileId);
  if (!fileIdInDb) {
    res.status(404).send({
      status: 'error',
      reason: 'invalid-file-id',
      details: 'File not found at server',
    });
    return;
  }

  const accesses = await UserService.getUserAccess(
    fileId,
    res.locals.user_id,
    await isAdmin(res.locals.user_id),
  );

  res.json(accesses);
});

app.post('/access', async (req, res) => {
  const userAccess = req.body || {};
  const session = await validateSession(req, res);

  if (!session) return;

  const { granted } = (await UserService.checkFilePermission(
    userAccess.fileId,
    session.user_id,
  )) || {
    granted: 0,
  };

  if (granted === 0 && !(await isAdmin(session.user_id))) {
    res.status(400).send({
      status: 'error',
      reason: 'file-denied',
      details: "You don't have permissions over this file",
    });
    return;
  }

  const fileIdInDb = await UserService.getFileById(userAccess.fileId);
  if (!fileIdInDb) {
    res.status(404).send({
      status: 'error',
      reason: 'invalid-file-id',
      details: 'File not found at server',
    });
    return;
  }

  if (!userAccess.userId) {
    res.status(400).send({
      status: 'error',
      reason: 'user-cant-be-empty',
      details: 'User cannot be empty',
    });
    return;
  }

  if ((await UserService.countUserAccess(userAccess.fileId, userAccess.userId)) > 0) {
    res.status(400).send({
      status: 'error',
      reason: 'user-already-have-access',
      details: 'User already have access',
    });
    return;
  }

  await UserService.addUserAccess(userAccess.userId, userAccess.fileId);

  res.status(200).send({ status: 'ok', data: {} });
});

app.delete('/access', async (req, res) => {
  const fileId = req.query.fileId;
  const session = await validateSession(req, res);
  if (!session) return;

  const { granted } = (await UserService.checkFilePermission(
    fileId,
    session.user_id,
  )) || {
    granted: 0,
  };

  if (granted === 0 && !(await isAdmin(session.user_id))) {
    res.status(400).send({
      status: 'error',
      reason: 'file-denied',
      details: "You don't have permissions over this file",
    });
    return;
  }

  const fileIdInDb = await UserService.getFileById(fileId);
  if (!fileIdInDb) {
    res.status(404).send({
      status: 'error',
      reason: 'invalid-file-id',
      details: 'File not found at server',
    });
    return;
  }

  const { ids } = req.body || {};
  const totalDeleted = await UserService.deleteUserAccessByFileId(ids, fileId);

  if (ids.length === totalDeleted) {
    res
      .status(200)
      .send({ status: 'ok', data: { someDeletionsFailed: false } });
  } else {
    res.status(400).send({
      status: 'error',
      reason: 'not-all-deleted',
      details: '',
    });
  }
});

app.get('/access/users', validateSessionMiddleware, async (req, res) => {
  const fileId = req.query.fileId;

  const { granted } = (await UserService.checkFilePermission(
    fileId,
    res.locals.user_id,
  )) || {
    granted: 0,
  };

  if (granted === 0 && !(await isAdmin(res.locals.user_id))) {
    res.status(400).send({
      status: 'error',
      reason: 'file-denied',
      details: "You don't have permissions over this file",
    });
    return;
  }

  const fileIdInDb = await UserService.getFileById(fileId);
  if (!fileIdInDb) {
    res.status(404).send({
      status: 'error',
      reason: 'invalid-file-id',
      details: 'File not found at server',
    });
    return;
  }

  const users = await UserService.getAllUserAccess(fileId);
  res.json(users);
});

app.post(
  '/access/transfer-ownership/',
  validateSessionMiddleware,
  async (req, res) => {
    const newUserOwner = req.body || {};

    const { granted } = (await UserService.checkFilePermission(
      newUserOwner.fileId,
      res.locals.user_id,
    )) || {
      granted: 0,
    };

    if (granted === 0 && !(await isAdmin(res.locals.user_id))) {
      res.status(400).send({
        status: 'error',
        reason: 'file-denied',
        details: "You don't have permissions over this file",
      });
      return;
    }

    const fileIdInDb = await UserService.getFileById(newUserOwner.fileId);
    if (!fileIdInDb) {
      res.status(404).send({
        status: 'error',
        reason: 'invalid-file-id',
        details: 'File not found at server',
      });
      return;
    }

    if (!newUserOwner.newUserId) {
      res.status(400).send({
        status: 'error',
        reason: 'user-cant-be-empty',
        details: 'Username cannot be empty',
      });
      return;
    }

    const newUserIdFromDb = await UserService.getUserById(newUserOwner.newUserId);
    if (!newUserIdFromDb) {
      res.status(400).send({
        status: 'error',
        reason: 'new-user-not-found',
        details: 'New user not found',
      });
      return;
    }

    await UserService.updateFileOwner(newUserOwner.newUserId, newUserOwner.fileId);

    res.status(200).send({ status: 'ok', data: {} });
  },
);

app.use(errorMiddleware);
