import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, parse } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type ConvertStatus = 'queued' | 'converting' | 'done' | 'error';

interface UploadedOfficeFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

interface ConvertJob {
  id: string;
  taskDir: string;
  originalName: string;
  outputName: string;
  sourcePath: string;
  outputPath: string;
  progress: number;
  status: ConvertStatus;
  message: string;
  createdAt: number;
  finishedAt?: number;
  cleanupAt?: number;
}

export interface ConvertProgress {
  taskId: string;
  fileName: string;
  progress: number;
  status: ConvertStatus;
  message: string;
  downloadUrl?: string;
}

@Injectable()
export class ConvertService implements OnModuleInit, OnModuleDestroy {
  private readonly supportedExts = new Set([
    'doc',
    'docx',
    'ppt',
    'pptx',
    'xls',
    'xlsx',
  ]);
  private readonly maxSize = 50 * 1024 * 1024;
  private readonly workspace = join(process.cwd(), 'storage');
  private readonly completedTtlMs = Number(
    process.env.CONVERT_COMPLETED_TTL_MS ?? 30 * 60 * 1000,
  );
  private readonly downloadedTtlMs = Number(
    process.env.CONVERT_DOWNLOADED_TTL_MS ?? 60 * 1000,
  );
  private readonly cleanupIntervalMs = Number(
    process.env.CONVERT_CLEANUP_INTERVAL_MS ?? 60 * 1000,
  );
  private readonly jobs = new Map<string, ConvertJob>();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredJobs();
    }, this.cleanupIntervalMs);
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  async createJob(file?: UploadedOfficeFile): Promise<ConvertProgress> {
    if (!file) {
      throw new BadRequestException('请上传文件');
    }

    const originalName = this.decodeFileName(file.originalname);
    const ext = extname(originalName).replace('.', '').toLowerCase();

    if (!this.supportedExts.has(ext)) {
      throw new BadRequestException('仅支持 Word、PPT、Excel 文件');
    }

    if (file.size > this.maxSize) {
      throw new BadRequestException('文件不能超过 50MB');
    }

    const id = randomUUID();
    const taskDir = join(this.workspace, id);
    const sourcePath = join(taskDir, `source.${ext}`);
    const outputName = `${parse(originalName).name}.pdf`;
    const outputPath = join(taskDir, outputName);

    await mkdir(taskDir, { recursive: true });
    await writeFile(sourcePath, file.buffer);

    const job: ConvertJob = {
      id,
      taskDir,
      originalName: basename(originalName),
      outputName,
      sourcePath,
      outputPath,
      progress: 5,
      status: 'queued',
      message: '文件已上传，等待转换',
      createdAt: Date.now(),
    };

    this.jobs.set(id, job);
    void this.runConvert(job);

    return this.toProgress(job);
  }

  getProgress(id: string): ConvertProgress {
    return this.toProgress(this.getJob(id));
  }

  getDownloadInfo(id: string) {
    const job = this.getJob(id);

    if (job.status !== 'done' || !existsSync(job.outputPath)) {
      throw new BadRequestException('文件尚未转换完成');
    }

    return {
      path: job.outputPath,
      fileName: job.outputName,
    };
  }

  private async runConvert(job: ConvertJob) {
    try {
      job.status = 'converting';
      job.progress = 15;
      job.message = '正在准备转换环境';

      const soffice = this.findLibreOffice();

      if (!soffice) {
        throw new Error(
          '未检测到 LibreOffice，无法执行真实 Office 转 PDF。请安装 LibreOffice，或设置 LIBREOFFICE_PATH 指向 soffice。',
        );
      }

      job.progress = 35;
      job.message = '正在调用 LibreOffice 转换';

      await execFileAsync(soffice, [
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        join(this.workspace, job.id),
        job.sourcePath,
      ]);

      job.progress = 88;
      job.message = '正在整理转换结果';

      const convertedPath = await this.findConvertedPdf(job);

      if (convertedPath !== job.outputPath) {
        await rename(convertedPath, job.outputPath);
      }

      job.progress = 100;
      job.status = 'done';
      job.message = '转换完成';
      this.scheduleCleanup(job, this.completedTtlMs);
    } catch (error) {
      job.status = 'error';
      job.progress = 100;
      job.message = error instanceof Error ? error.message : '转换失败';
      this.scheduleCleanup(job, this.completedTtlMs);
    }
  }

  markDownloaded(id: string) {
    const job = this.getJob(id);
    this.scheduleCleanup(job, this.downloadedTtlMs);
  }

  private findLibreOffice() {
    const candidates = [
      process.env.LIBREOFFICE_PATH,
      '/usr/bin/libreoffice',
      '/usr/bin/soffice',
      '/usr/local/bin/libreoffice',
      '/usr/local/bin/soffice',
      '/usr/lib/libreoffice/program/soffice',
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      '/usr/local/bin/soffice',
      '/opt/homebrew/bin/soffice',
    ].filter(Boolean) as string[];

    return candidates.find((candidate) => existsSync(candidate));
  }

  private decodeFileName(fileName: string) {
    const decoded = Buffer.from(fileName, 'latin1').toString('utf8');

    if (decoded.includes('�')) {
      return basename(fileName);
    }

    return basename(decoded);
  }

  createDownloadStream(path: string) {
    return createReadStream(path);
  }

  private scheduleCleanup(job: ConvertJob, ttlMs: number) {
    const now = Date.now();
    job.finishedAt = job.finishedAt ?? now;
    job.cleanupAt = now + ttlMs;
  }

  private async cleanupExpiredJobs() {
    const now = Date.now();

    await Promise.all(
      Array.from(this.jobs.values()).map(async (job) => {
        if (!job.cleanupAt || job.cleanupAt > now) {
          return;
        }

        try {
          await rm(job.taskDir, { recursive: true, force: true });
        } finally {
          this.jobs.delete(job.id);
        }
      }),
    );
  }

  private async findConvertedPdf(job: ConvertJob) {
    const taskDir = join(this.workspace, job.id);
    const files = await readdir(taskDir);
    const pdf = files.find((file) => file.toLowerCase().endsWith('.pdf'));

    if (!pdf) {
      throw new InternalServerErrorException('未找到转换后的 PDF 文件');
    }

    return join(taskDir, pdf);
  }

  private getJob(id: string) {
    const job = this.jobs.get(id);

    if (!job) {
      throw new NotFoundException('任务不存在');
    }

    return job;
  }

  private toProgress(job: ConvertJob): ConvertProgress {
    return {
      taskId: job.id,
      fileName: job.originalName,
      progress: job.progress,
      status: job.status,
      message: job.message,
      downloadUrl:
        job.status === 'done' ? `/api/convert/${job.id}/download` : undefined,
    };
  }
}
