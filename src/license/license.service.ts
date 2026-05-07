import {
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';

interface LicenseCode {
  code: string;
  createdAt: number;
  expiresAt: number;
}

export interface CreatedLicenseCode {
  code: string;
  expiresAt: number;
  ttlSeconds: number;
}

export interface VerifiedLicenseCode {
  valid: true;
  code: string;
  expiresAt: number;
  ttlSeconds: number;
}

@Injectable()
export class LicenseService implements OnModuleInit, OnModuleDestroy {
  private readonly alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  private readonly codeLength = 6;
  private readonly ttlMs = Number(process.env.LICENSE_CODE_TTL_MS ?? 2 * 60 * 60 * 1000);
  private readonly cleanupIntervalMs = Number(process.env.LICENSE_CLEANUP_INTERVAL_MS ?? 60 * 1000);
  private readonly codes = new Map<string, LicenseCode>();
  private cleanupTimer?: ReturnType<typeof setInterval>;

  onModuleInit() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredCodes();
    }, this.cleanupIntervalMs);
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  createCode(adminSecret?: string): CreatedLicenseCode {
    this.assertAdminSecret(adminSecret);

    const now = Date.now();
    const code = this.generateUniqueCode();
    const licenseCode: LicenseCode = {
      code,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };

    this.codes.set(code, licenseCode);

    return {
      code,
      expiresAt: licenseCode.expiresAt,
      ttlSeconds: Math.floor(this.ttlMs / 1000),
    };
  }

  assertValidCode(code?: string) {
    this.getValidCode(code);
  }

  verifyCode(code?: string): VerifiedLicenseCode {
    const licenseCode = this.getValidCode(code);

    return {
      valid: true,
      code: licenseCode.code,
      expiresAt: licenseCode.expiresAt,
      ttlSeconds: Math.max(0, Math.ceil((licenseCode.expiresAt - Date.now()) / 1000)),
    };
  }

  private getValidCode(code?: string) {
    const normalizedCode = code?.trim().toUpperCase();

    if (!normalizedCode) {
      throw new ForbiddenException('请先输入授权码');
    }

    const licenseCode = this.codes.get(normalizedCode);

    if (!licenseCode) {
      throw new ForbiddenException('授权码无效，请检查后重试');
    }

    if (licenseCode.expiresAt <= Date.now()) {
      this.codes.delete(normalizedCode);
      throw new ForbiddenException('授权码已过期，请重新获取');
    }

    return licenseCode;
  }

  private assertAdminSecret(adminSecret?: string) {
    const expectedSecret = process.env.LICENSE_ADMIN_SECRET || 'pqf';

    if (!expectedSecret) {
      throw new ForbiddenException('服务端未配置管理员密钥，无法生成授权码');
    }

    if (!adminSecret || adminSecret !== expectedSecret) {
      throw new ForbiddenException('管理员密钥无效');
    }
  }

  private generateUniqueCode() {
    let code = this.generateCode();

    while (this.codes.has(code)) {
      code = this.generateCode();
    }

    return code;
  }

  private generateCode() {
    return Array.from({ length: this.codeLength }, () => {
      return this.alphabet[randomInt(this.alphabet.length)];
    }).join('');
  }

  private cleanupExpiredCodes() {
    const now = Date.now();

    for (const [code, licenseCode] of this.codes.entries()) {
      if (licenseCode.expiresAt <= now) {
        this.codes.delete(code);
      }
    }
  }
}
