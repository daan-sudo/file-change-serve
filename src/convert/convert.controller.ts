import {
  Controller,
  Get,
  Param,
  Post,
  Headers,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ConvertService } from './convert.service';

@Controller('api/convert')
export class ConvertController {
  constructor(private readonly convertService: ConvertService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  create(
    @UploadedFile()
    file: {
      originalname: string;
      buffer: Buffer;
      size: number;
    },
    @Headers('x-license-code') licenseCode?: string,
  ) {
    return this.convertService.createJob(file, licenseCode);
  }

  @Get(':id/progress')
  getProgress(@Param('id') id: string) {
    return this.convertService.getProgress(id);
  }

  @Get(':id/download')
  download(
    @Param('id') id: string,
    @Query('licenseCode') licenseCode: string | undefined,
    @Res() response: Response,
  ) {
    this.convertService.assertLicenseCode(licenseCode);
    const file = this.convertService.getDownloadInfo(id);
    const encodedFileName = encodeURIComponent(file.fileName);
    const fallbackFileName = file.fileName.replace(/[^\x20-\x7E]/g, '_');

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodedFileName}`,
    );
    response.on('finish', () => {
      this.convertService.markDownloaded(id);
    });

    return this.convertService.createDownloadStream(file.path).pipe(response);
  }
}
