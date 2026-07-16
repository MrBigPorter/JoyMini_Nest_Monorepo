import { AuthService } from '@api/client/auth/auth.service';
import { AddressService } from '@api/client/address/address.service';
import { TaggedTool } from '@api/client/ai-customer/graph/tools/tool-registry.service';
import { Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import { toLLM } from '@api/common/ai/utils/to-llm';
import { plainToInstance } from 'class-transformer';
import { UserProfileResponseDto } from '@api/client/auth/dto/user-profile.response.dto';
import {
  toolFailure,
  toolSuccess,
} from '@api/client/ai-customer/graph/tools/tool-result';
import { z } from 'zod';
import { AddressResponseDto } from '@api/client/address/dto/address.dto';
import {
  CreateAddressDto,
  UpdateAddressDto,
} from '@api/client/address/dto/address.dto';
import { toResultChain } from '@lucky/shared';

export const createUserTools = (
  authService: AuthService,
  addressService: AddressService,
): TaggedTool[] => {
  const logger = new Logger('UserTools');
  return [
    /**
     * 获取当前用户的个人信息
     * @param userId - 当前用户 ID，由 LLM 自动传递
     */
    {
      tool: tool(
        async ({ userId }: { userId: string }) =>
          toResultChain(authService.profile(userId))
            .then((result) =>
              toolSuccess({
                profile: toLLM(
                  plainToInstance(UserProfileResponseDto, result),
                  UserProfileResponseDto,
                  'en',
                ),
              }),
            )
            .catch((err) =>
              toolFailure(`Failed to get profile: ${err.message}`),
            ),
        {
          name: 'getUserProfile',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
          }),
          description:
            'Get the current user personal profile info: nickname, avatar, phone, invite code, VIP level, KYC status, last login time.',
        },
      ),
      displayName: 'Loading your profile...',
      tags: ['user'],
    },
    {
      tool: tool(
        async ({
          userId,
          page,
          pageSize,
        }: {
          userId: string;
          page?: number;
          pageSize?: number;
        }) =>
          toResultChain(
            addressService.list(userId, {
              page: page ?? 1,
              pageSize: pageSize ?? 10,
            }),
          )
            .then((result) =>
              toolSuccess({
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                addresses: (result.list ?? []).map((item: any) =>
                  toLLM(
                    plainToInstance(AddressResponseDto, item),
                    AddressResponseDto,
                    'en',
                  ),
                ),
              }),
            )
            .catch((err) =>
              toolFailure(`Failed to list addresses: ${err.message}`),
            ),
        {
          name: 'listAddresses',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            page: z
              .number()
              .optional()
              .default(1)
              .describe('The page of Address list'),
            pageSize: z.number().optional().default(10),
          }),
          description:
            "List the current user's saved delivery addresses with pagination.",
        },
      ),
      displayName: 'Looking up addresses...',
      tags: ['user'],
    },
    {
      /**
       * 查看单个地址详情
       * @param userId - 当前用户 ID
       * @param addressId - 地址 ID
       */
      tool: tool(
        async ({ userId, addressId }: { userId: string; addressId: string }) =>
          toResultChain(addressService.detail(userId, addressId))
            .then((result) =>
              toolSuccess({
                address: toLLM(
                  plainToInstance(AddressResponseDto, result),
                  AddressResponseDto,
                  'en',
                ),
              }),
            )
            .catch((err) =>
              toolFailure(`Failed to get address detail: ${err.message}`),
            ),
        {
          name: 'getAddressDetail',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            addressId: z.string().describe('The address ID to query'),
          }),
          description:
            'Get details of a specific delivery address by addressId.',
        },
      ),
      displayName: 'Getting address details...',
      tags: ['user'],
    },
    /**
     * 新增收货地址（写操作）
     * 注意：必须两阶段确认，先展示预览，用户确认后再执行
     *
     * 工作流（类似取款表单流程）：
     * 1. AI 先调 getUserProfile 预填 contactName 和 phone
     * 2. 逐个问用户 province, city, barangay
     * 3. 问 fullAddress（街道楼栋等）
     * 4. 展示预览，等用户确认
     * 5. 调 createAddress 执行
     */
    {
      tool: tool(
        async ({
          userId,
          contactName,
          phone,
          province,
          city,
          barangay,
          fullAddress,
          label,
          isDefault,
        }: {
          userId: string;
          contactName: string;
          phone: string;
          province: string;
          city: string;
          barangay: string;
          fullAddress: string;
          label?: string;
          isDefault?: boolean;
        }) => {
          logger.log(
            `[user-tools:createAddress] userId="${userId}", contactName="${contactName}"`,
          );
          // Resolve text region names to numeric IDs
          const geo = await addressService.resolveGeoIds(
            province,
            city,
            barangay,
          );
          const dto: CreateAddressDto = {
            contactName,
            phone,
            provinceId: geo.provinceId,
            cityId: geo.cityId,
            barangayId: geo.barangayId,
            fullAddress,
            label,
            isDefault: isDefault ? 1 : 0,
          };
          return toResultChain(addressService.create(userId, dto))
            .then((result) =>
              toolSuccess({
                addressId: result.addressId,
                message: 'Address created successfully',
              }),
            )
            .catch((err) =>
              toolFailure(`Failed to create address: ${err.message}`),
            );
        },
        {
          /**
           * 新增收货地址（写操作）
           * 注意：必须两阶段确认，先展示预览，用户确认后再执行
           */
          name: 'createAddress',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            contactName: z
              .string()
              .describe(
                'Contact name (pre-fill from getUserProfile if available)',
              ),
            phone: z
              .string()
              .describe(
                'Phone number (pre-fill from getUserProfile if available)',
              ),
            province: z
              .string()
              .describe(
                'Province/Region name (e.g. Metro Manila, Cavite). NOT an ID — the system will resolve this automatically.',
              ),
            city: z
              .string()
              .describe(
                'City/Municipality name (e.g. Makati, Dasmariñas). NOT an ID — the system will resolve this automatically.',
              ),
            barangay: z
              .string()
              .describe(
                'Barangay/District name (e.g. Bel-Air, Poblacion). NOT an ID — the system will resolve this automatically.',
              ),
            fullAddress: z
              .string()
              .describe(
                'Full address: street, building, unit, landmark details',
              ),
            label: z
              .string()
              .optional()
              .describe('Label for the address e.g. Home, Office'),
            isDefault: z
              .boolean()
              .optional()
              .describe('Whether to set as default address'),
          }),
          description:
            'Create a new delivery address (text-based region names). **IMPORTANT: Two-phase flow required: 1) First call getUserProfile to pre-fill name/phone, 2) Collect info naturally one field at a time (like a form), 3) Show preview for confirmation, 4) Only call this on user confirmation.**',
        },
      ),
      displayName: 'Saving new address...',
      tags: ['user'],
    },
    /**
     * 修改收货地址（写操作）
     * 注意：必须两阶段确认
     */
    {
      tool: tool(
        async ({
          userId,
          addressId,
          contactName,
          phone,
          province,
          city,
          barangay,
          fullAddress,
          label,
          isDefault,
        }: {
          userId: string;
          addressId: string;
          contactName?: string;
          phone?: string;
          province?: string;
          city?: string;
          barangay?: string;
          fullAddress?: string;
          label?: string;
          isDefault?: boolean;
        }) => {
          logger.log(
            `[user-tools:updateAddress] userId="${userId}", addressId="${addressId}"`,
          );
          // Resolve text region names to IDs if provided
          let provinceId: number | undefined;
          let cityId: number | undefined;
          let barangayId: number | undefined;
          if (province && city && barangay) {
            const geo = await addressService.resolveGeoIds(
              province,
              city,
              barangay,
            );
            provinceId = geo.provinceId;
            cityId = geo.cityId;
            barangayId = geo.barangayId;
          }
          // Build partial DTO, removing undefined keys
          const dto = Object.fromEntries(
            Object.entries({
              contactName,
              phone,
              provinceId,
              cityId,
              barangayId,
              fullAddress,
              label,
              isDefault:
                isDefault !== undefined ? (isDefault ? 1 : 0) : undefined,
            }).filter(([_, v]) => v !== undefined),
          );

          return toResultChain(
            addressService.update(
              userId,
              addressId,
              dto as unknown as UpdateAddressDto,
            ),
          )
            .then((result) =>
              toolSuccess({
                addressId: result.addressId,
                message: 'Address updated successfully',
              }),
            )
            .catch((err) =>
              toolFailure(`Failed to update address: ${err.message}`),
            );
        },
        {
          name: 'updateAddress',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            addressId: z.string().describe('The address ID to update'),
            contactName: z.string().optional().describe('New contact name'),
            phone: z.string().optional().describe('New phone number'),
            province: z
              .string()
              .optional()
              .describe(
                'New Province/Region name (e.g. Metro Manila). Text, not ID.',
              ),
            city: z
              .string()
              .optional()
              .describe(
                'New City/Municipality name (e.g. Makati). Text, not ID.',
              ),
            barangay: z
              .string()
              .optional()
              .describe(
                'New Barangay/District name (e.g. Bel-Air). Text, not ID.',
              ),
            fullAddress: z
              .string()
              .optional()
              .describe(
                'New full address: street, building, unit, landmark details',
              ),
            label: z
              .string()
              .optional()
              .describe('New label e.g. Home, Office'),
            isDefault: z
              .boolean()
              .optional()
              .describe('Whether to set as default address'),
          }),
          description:
            'Update an existing delivery address. Text-based region names supported. **IMPORTANT: First show a preview of the changes to the user and ask for confirmation before updating.**',
        },
      ),
      displayName: 'Updating address...',
      tags: ['user'],
    },
    /**
     * 删除收货地址（写操作）
     * 注意：必须两阶段确认
     */
    {
      tool: tool(
        async ({
          userId,
          addressId,
        }: {
          userId: string;
          addressId: string;
        }) => {
          logger.log(
            `[user-tools:deleteAddress] userId="${userId}", addressId="${addressId}"`,
          );
          return toResultChain(addressService.delete(userId, addressId))
            .then(() =>
              toolSuccess({
                success: true,
                message: 'Address deleted successfully',
              }),
            )
            .catch((err) =>
              toolFailure(`Failed to delete address: ${err.message}`),
            );
        },
        {
          name: 'deleteAddress',
          schema: z.object({
            userId: z.string().describe('The current user ID'),
            addressId: z.string().describe('The address ID to delete'),
          }),
          description:
            'Delete a delivery address by addressId. **IMPORTANT: Confirm with the user before deleting.** Show the address details first and ask for confirmation.',
        },
      ),
      displayName: 'Deleting address...',
      tags: ['user'],
    },
  ];
};
