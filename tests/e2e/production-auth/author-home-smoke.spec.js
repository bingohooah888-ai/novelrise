import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixturePath = process.env.PRODUCTION_AUTH_SMOKE_FIXTURE;
const profileRpcPath = '/rest/v1/rpc/novelight_update_my_public_profile';
const avatarObjectPath = '/storage/v1/object/author-avatars/';
const avatarFixturePath = fileURLToPath(
  new URL('../../../assets/novelight-header-logo.webp', import.meta.url)
);

if (!fixturePath) {
  throw new Error('PRODUCTION_AUTH_SMOKE_FIXTURE is required.');
}

function loadFixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

async function loginToAuthorHome(page, account) {
  await page.goto('/login.html?redirect=mypage.html');
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('#loginButton').click();
  await page.waitForURL((url) => url.pathname.endsWith('/mypage.html'));
}

test('author home profile, avatar, and activity work in Production', async ({
  page
}) => {
  const fixture = loadFixture();
  const author = fixture.projects?.desktop?.author;
  if (!author) {
    throw new Error('Missing desktop author smoke identity.');
  }

  await loginToAuthorHome(page, author);

  await expect(
    page.getByRole('heading', { name: /作者ホーム$/ })
  ).toBeVisible();
  await expect(page.locator('#save')).toBeEnabled();
  await expect(page.locator('#avatarInput')).toBeEnabled();

  const activityList = page.locator('#activityList');
  await expect(activityList).not.toContainText('読み込んでいます');
  await expect(activityList).not.toContainText('読み込めませんでした');

  const editedName = `${author.displayName} プロフィール`;
  const editedBio = `Production smoke ${fixture.runId} author profile`;
  const profileStatus = page.locator('#profileStatus');

  await page.locator('.profile-editor summary').click();
  await page.locator('#name').fill(editedName);
  await page.locator('#bio').fill(editedBio);

  const profileUpdate = page.waitForResponse(
    (response) =>
      response.url().includes(profileRpcPath) &&
      response.request().method() === 'POST'
  );
  await page.locator('#save').click();
  expect((await profileUpdate).ok()).toBeTruthy();
  await expect(profileStatus).toHaveText('保存しました。');
  await expect(page.locator('#profileDisplayName')).toHaveText(editedName);
  await expect(page.locator('#profileBioSummary')).toHaveText(editedBio);
  await expect(page.locator('#accountName')).toHaveText(editedName);

  const avatarUpload = page.waitForResponse(
    (response) =>
      response.url().includes(avatarObjectPath) &&
      response.request().method() === 'POST'
  );
  const avatarProfileUpdate = page.waitForResponse(
    (response) =>
      response.url().includes(profileRpcPath) &&
      response.request().method() === 'POST'
  );
  await page.locator('#avatarInput').setInputFiles(avatarFixturePath);

  expect((await avatarUpload).ok()).toBeTruthy();
  expect((await avatarProfileUpdate).ok()).toBeTruthy();
  await expect(profileStatus).toHaveText('アイコンを更新しました。');

  const avatarImage = page.locator('#profileAvatar img');
  const publicAvatarPrefix = `${avatarObjectPath}public/author-avatars/${author.id}/`;
  await expect(avatarImage).toBeVisible();
  await expect(avatarImage).toHaveAttribute('src', new RegExp(publicAvatarPrefix));
  await expect(page.locator('#accountAvatar img')).toBeVisible();
});
