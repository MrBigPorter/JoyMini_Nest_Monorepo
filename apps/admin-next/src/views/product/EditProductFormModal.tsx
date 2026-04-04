'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToastStore } from '@/store/useToastStore';
import { productApi, uploadApi } from '@/api';
import { z } from 'zod';
import { createProductSchema } from '@/schema/productSchema';
import { Category, CreateProduct, Product } from '@/type/types';
import {
  Button,
  Form,
  FormMediaUploaderField,
  FormSelectField,
  FormTextField,
  FormDateField,
  FormRichTextField,
  FormCheckboxField, // 确保有这个
} from '@repo/ui';
import { useRequest } from 'ahooks';
import { SmartImage } from '@/components/ui/SmartImage';
import { Bot, Info } from 'lucide-react';

// 扩展类型
type ProductFormInputs = z.infer<typeof createProductSchema> & {
  bonusItemName?: string;
  bonusItemImg?: string | File;
  bonusWinnerCount?: number;
};

interface EditProductFormModalProps {
  categories: Category[];
  confirm: () => void;
  product: Product;
}

export const EditProductFormModal: React.FC<EditProductFormModalProps> = ({
  categories,
  confirm,
  product,
}) => {
  const addToast = useToastStore((s) => s.addToast);

  const { run: updateProduct, loading } = useRequest(productApi.updateProduct, {
    manual: true,
    onSuccess: () => {
      addToast('success', 'Product updated successfully');
      confirm();
    },
  });

  const upload = useRequest(uploadApi.uploadMedia, {
    manual: true,
  });

  // 解析 bonusConfig
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bonusConfig = product.bonusConfig as any;

  const form = useForm<ProductFormInputs>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      // --- 1. 基础信息回填 ---
      treasureName: product.treasureName,
      seqShelvesQuantity: product.seqShelvesQuantity,
      categoryIds: product.categories?.[0]?.categoryId,
      treasureCoverImg: product.treasureCoverImg,
      desc: product.desc,
      ruleContent: product.ruleContent,

      // --- 2. 价格体系回填 ---
      unitAmount: product.unitAmount,
      costAmount: product.costAmount,
      marketAmount: product.marketAmount,
      soloAmount: product.soloAmount,

      // --- 3. 物流与拼团回填 ---
      shippingType: product.shippingType ?? 1,
      weight: product.weight ?? 0,
      groupSize: product.groupSize ?? 5,
      groupTimeLimit: product.groupTimeLimit ?? 86400,

      // --- 4. 自动化配置回填 ---
      enableRobot: product.enableRobot ?? false,
      robotDelay: product.robotDelay ?? 300,
      leaderBonusType: product.leaderBonusType ?? 0,

      // --- 5. 时间回填 (Timestamp -> Date) ---
      salesStartAt: product.salesStartAt
        ? new Date(product.salesStartAt)
        : undefined,
      salesEndAt: product.salesEndAt ? new Date(product.salesEndAt) : undefined,

      // --- 6. 赠品回填 ---
      bonusItemName: bonusConfig?.bonusItemName || '',
      bonusItemImg: bonusConfig?.bonusItemImg || '',
      bonusWinnerCount: bonusConfig?.winnerCount || 1,
    },
  });

  const handleEditorUpload = async (file: File): Promise<string> => {
    try {
      const res = await upload.runAsync(file);
      return res.url;
    } catch (error) {
      addToast('error', 'Editor image upload failed');
      throw error;
    }
  };

  const onSubmit = async (values: ProductFormInputs) => {
    try {
      // 1. 处理主图上传
      let coverUrl: string;
      if (values.treasureCoverImg instanceof File) {
        const { url } = await upload.runAsync(values.treasureCoverImg);
        coverUrl = url;
      } else {
        coverUrl = values.treasureCoverImg as string;
      }

      // 2. 处理赠品图上传
      let bonusImgUrl: string = '';
      if (values.bonusItemImg instanceof File) {
        const { url } = await upload.runAsync(values.bonusItemImg);
        bonusImgUrl = url;
      } else {
        bonusImgUrl = (values.bonusItemImg as string) || '';
      }

      // 3. 组装 Payload
      const payload: CreateProduct = {
        treasureName: values.treasureName,
        seqShelvesQuantity: Number(values.seqShelvesQuantity),
        categoryIds: [Number(values.categoryIds)],
        treasureCoverImg: coverUrl,
        desc: values.desc,
        ruleContent: values.ruleContent,

        // 价格
        unitAmount: Number(values.unitAmount),
        costAmount: Number(values.costAmount),
        marketAmount:
          values.marketAmount !== undefined && values.marketAmount !== null
            ? Number(values.marketAmount)
            : undefined,
        soloAmount:
          values.soloAmount !== undefined && values.soloAmount !== null
            ? Number(values.soloAmount)
            : undefined,

        // 物流
        shippingType: Number(values.shippingType),
        weight: Number(values.weight),

        // 拼团与自动化
        groupSize: Number(values.groupSize),
        groupTimeLimit: Number(values.groupTimeLimit),
        enableRobot: Boolean(values.enableRobot),
        robotDelay: values.robotDelay ? Number(values.robotDelay) : 300,
        leaderBonusType: Number(values.leaderBonusType || 0),

        // 时间
        salesStartAt: values.salesStartAt
          ? new Date(values.salesStartAt).getTime()
          : undefined,
        salesEndAt: values.salesEndAt
          ? new Date(values.salesEndAt).getTime()
          : undefined,

        // Bonus Config
        bonusConfig: values.bonusItemName
          ? {
              bonusItemName: values.bonusItemName,
              bonusItemImg: bonusImgUrl,
              winnerCount: Number(values.bonusWinnerCount || 1),
              allowRobot: true,
            }
          : undefined,
      };

      updateProduct(product.treasureId, payload);
    } catch (e) {
      // 4xx 由 HTTP 拦截器统一 toast，此处不重复 console.error
      const status = (e as { response?: { status?: number } })?.response
        ?.status;
      if (!status || status < 400 || status >= 500) console.error(e);
      addToast('error', 'Failed to update product');
    }
  };

  // Watch enableRobot to conditionally render delay field
  const enableRobot = form.watch('enableRobot');

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6 h-[650px] overflow-y-auto px-1 scrollbar-thin scrollbar-thumb-gray-200"
      >
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6">
          {/* 左侧：表单字段 */}
          <div className="space-y-6">
            {/* 1. Basic Info */}
            <div className="space-y-4 p-4 border rounded-lg shadow-sm">
              <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                📦 Basic Information
              </h3>
              <FormTextField
                required
                autoComplete="off"
                name="treasureName"
                label="Product Name"
              />

              <div className="grid grid-cols-2 gap-4">
                <FormTextField
                  required
                  name="seqShelvesQuantity"
                  label="Stock (Shares)"
                  type="number"
                />
                <FormSelectField
                  required
                  name="categoryIds"
                  label="Category"
                  options={categories.map((c) => ({
                    label: c.name,
                    value: c.id.toString(),
                  }))}
                />
              </div>
            </div>

            {/* 2. Price Structure (Updated) */}
            <div className="space-y-4 p-4 border rounded-lg bg-green-50/30 shadow-sm border-green-100">
              <h3 className="font-semibold text-sm text-green-800 flex items-center gap-2">
                💰 Price Structure
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <FormTextField
                  required
                  name="unitAmount"
                  label="Group Price (Main)"
                  type="number"
                  placeholder="0.00"
                  renderRight={() => (
                    <span className="text-xs text-gray-500">₱</span>
                  )}
                />
                <FormTextField
                  name="costAmount"
                  label="Cost"
                  type="number"
                  placeholder="0.00"
                  renderRight={() => (
                    <span className="text-xs text-gray-500">₱</span>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormTextField
                  name="soloAmount"
                  label="Solo Price (Direct)"
                  type="number"
                  placeholder="Optional"
                  renderRight={() => (
                    <span className="text-xs text-gray-500">₱</span>
                  )}
                />
                <FormTextField
                  name="marketAmount"
                  label="MSRP (Strikethrough)"
                  type="number"
                  placeholder="Optional"
                  renderRight={() => (
                    <span className="text-xs text-gray-500">₱</span>
                  )}
                />
              </div>
            </div>

            {/* 3. Group & Automation (New) */}
            <div className="space-y-4 p-4 border rounded-lg bg-blue-50/30 shadow-sm border-blue-100">
              <h3 className="font-semibold text-sm text-blue-800 flex items-center gap-2">
                <Bot size={16} /> Group & Automation
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <FormTextField
                  name="groupSize"
                  label="Group Size"
                  type="number"
                />
                <FormTextField
                  name="groupTimeLimit"
                  label="Time Limit (Sec)"
                  type="number"
                />
              </div>

              <div className="flex items-center gap-4 pt-2 border-t border-blue-100">
                <div className="flex-1">
                  <FormCheckboxField
                    name="enableRobot"
                    label="Enable Robot Auto-fill"
                  />
                </div>
                {enableRobot && (
                  <div className="flex-1">
                    <FormTextField
                      name="robotDelay"
                      label="Robot Delay (Sec)"
                      type="number"
                      placeholder="300"
                    />
                  </div>
                )}
              </div>

              <div className="pt-2">
                <FormSelectField
                  name="leaderBonusType"
                  label="Group Leader Bonus"
                  options={[
                    { label: 'None', value: '0' },
                    { label: 'Free Order (免单)', value: '1' },
                    { label: 'Commission (佣金)', value: '2' },
                  ]}
                />
              </div>
            </div>

            {/* 4. Sales Duration */}
            <div className="space-y-4 p-4 border rounded-lg bg-gray-50/50 shadow-sm">
              <h3 className="font-semibold text-sm text-gray-900">
                ⏰ Sales Duration
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormDateField name="salesStartAt" label="Start Time" />
                <FormDateField name="salesEndAt" label="End Time" />
              </div>
            </div>

            {/* 5. Logistics */}
            <div className="space-y-4 p-4 border rounded-lg bg-gray-50/50 shadow-sm">
              <h3 className="font-semibold text-sm text-gray-900">
                🚚 Logistics
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <FormSelectField
                  name="shippingType"
                  label="Shipping Type"
                  options={[
                    { label: 'Physical Shipping', value: '1' },
                    { label: 'No Shipping', value: '2' },
                  ]}
                />
                <FormTextField
                  name="weight"
                  label="Weight (kg)"
                  type="number"
                  renderRight={() => (
                    <span className="text-xs text-gray-500">0.01</span>
                  )}
                />
              </div>
            </div>

            {/* 6. Rich Text */}
            <div className="space-y-4">
              <FormRichTextField
                name="desc"
                label="Product Details"
                onUpload={handleEditorUpload}
              />
              <FormRichTextField
                name="ruleContent"
                label="Rules Content"
                onUpload={handleEditorUpload}
              />
            </div>
          </div>

          {/* 右侧：图片与赠品 (Sticky) */}
          <div className="flex flex-col gap-4">
            <div className="sticky top-0 space-y-4">
              <div className="p-4 border rounded-lg  shadow-sm">
                <FormMediaUploaderField
                  name="treasureCoverImg"
                  label="Cover Image"
                  maxFileCount={1}
                  renderImage={({ src, alt, className }) => (
                    <SmartImage
                      src={src}
                      alt={alt}
                      width={400}
                      height={400}
                      className={className}
                      imgClassName="w-64 h-64 rounded-md object-cover"
                      layout="constrained"
                    />
                  )}
                />
                <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                  <Info size={12} /> Recommended 800x800px
                </p>
              </div>

              {/* Bonus Config */}
              <div className="space-y-4 p-4 border rounded-lg border-yellow-200 bg-yellow-50/30 shadow-sm">
                <h3 className="font-semibold text-sm text-yellow-800 flex items-center gap-2">
                  🎁 Bonus Prize
                </h3>
                <FormTextField name="bonusItemName" label="Item Name" />
                <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
                  <div className="flex-1">
                    <FormTextField
                      name="bonusWinnerCount"
                      label="Winners Count"
                      type="number"
                    />
                  </div>
                </div>
                <FormMediaUploaderField
                  name="bonusItemImg"
                  label="Gift Img"
                  maxFileCount={1}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 flex justify-end gap-3 sticky bottom-0 backdrop-blur-sm z-10 py-4 border-t border-gray-100">
          <Button variant="outline" onClick={() => confirm?.()}>
            Cancel
          </Button>
          <Button isLoading={loading || upload.loading} type="submit">
            Confirm Update
          </Button>
        </div>
      </form>
    </Form>
  );
};
