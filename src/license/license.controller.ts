import { Controller, Get, Headers, Post } from '@nestjs/common';
import { LicenseService } from './license.service';

@Controller('api/licenses')
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Post()
  create(@Headers('x-admin-secret') adminSecret?: string) {
    return this.licenseService.createCode(adminSecret);
  }

  @Get('verify')
  verify(@Headers('x-license-code') licenseCode?: string) {
    return this.licenseService.verifyCode(licenseCode);
  }
}
