import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class MediaService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get static map image from Google Maps API via proxy
   * @param lat
   * @param lng
   */
  async getStaticMapProxy(lat: number, lng: number): Promise<Buffer> {
    const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    //  Google API URL
    const url = `https://maps.googleapis.com/maps/api/staticmap`;

    try {
      const response$ = this.httpService.get(url, {
        params: {
          center: `${lat},${lng}`,
          zoom: 15,
          size: '600x320',
          maptype: 'roadmap',
          markers: `color:red|${lat},${lng}`,
          key: apiKey,
        },
        responseType: 'arraybuffer',
      });

      const response = await lastValueFrom(response$);
      return response.data as Buffer; // return image buffer
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Google Maps Proxy Error:', message);
      throw new InternalServerErrorException('Failed to fetch map');
    }
  }
}
