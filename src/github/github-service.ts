import type { RestEndpointMethodTypes } from '@octokit/rest';
import { PullRequestInfo, FileChange } from '../types/index.js';
import { Octokit } from '@octokit/rest';

export class GitHubService {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async getPullRequestInfo(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PullRequestInfo> {
    const { data: pr } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    const { data: files } = await this.octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    const fileChanges: FileChange[] = files.map((file) => ({
      filename: file.filename,
      status: file.status as 'added' | 'modified' | 'removed',
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    }));

    return {
      owner,
      repo,
      prNumber,
      title: pr.title,
      body: pr.body,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      author: pr.user?.login || '',
      files: fileChanges,
    };
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<string | null> {
    try {
      const response = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      const data =
        response.data as RestEndpointMethodTypes['repos']['getContent']['response']['data'];

      if ('content' in data && !Array.isArray(data)) {
        const content = Buffer.from(data.content, 'base64').toString('utf8');

        return content;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async getRepoContent(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<RepoItem[]> {
    try {
      const response = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      const data = response.data;

      if (Array.isArray(data)) {
        return data.map((item) => ({
          name: item.name,
          path: item.path,
          type: item.type as 'file' | 'dir',
          sha: item.sha,
        }));
      } else if (data.type === 'file') {
        return [
          {
            name: data.name,
            path: data.path,
            type: 'file',
            sha: data.sha,
          },
        ];
      }

      return [];
    } catch (error) {
      return [];
    }
  }

  async loadFileContents(pullRequestInfo: PullRequestInfo): Promise<PullRequestInfo> {
    const { owner, repo, baseBranch, files } = pullRequestInfo;

    const filesWithContent = await Promise.all(
      files.map(async (file) => {
        if (file.status !== 'removed') {
          const content = await this.getFileContent(owner, repo, file.filename, baseBranch);

          return {
            ...file,
            contents: content || undefined,
          };
        }

        return file;
      })
    );

    return {
      ...pullRequestInfo,
      files: filesWithContent,
    };
  }

  async createComment(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }

  // TODO: reduce the number of parameters.
  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    commit_id: string,
    body: string,
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  ): Promise<void> {
    await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id,
      body,
      event,
    });
  }

  async approvePullRequest(owner: string, repo: string, prNumber: number): Promise<void> {
    await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      event: 'APPROVE',
      body: 'Automatically approved based on code review results.',
    });
  }

  async mergePullRequest(owner: string, repo: string, prNumber: number): Promise<boolean> {
    try {
      await this.octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: 'merge',
      });

      return true;
    } catch (error) {
      await this.createComment(
        owner,
        repo,
        prNumber,
        '⚠️ PR was approved but could not be automatically merged. Please resolve any conflicts and merge manually.'
      );

      return false;
    }
  }
}

interface RepoItem {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
}
