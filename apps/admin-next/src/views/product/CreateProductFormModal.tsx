'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useToastStore } from '@/store/useToastStore';
import { productApi, uploadApi } from '@/api';
import { z } from 'zod';
import { createProductSchema } from '@/schema/productSchema';
import { Category, CreateProduct } from '@/type/types';
import {
  Button,
  Form,
  FormMediaUploaderField,
  FormSelectField,
  FormTextField,
  FormDateField,
  FormRichTextField,
  FormCheckboxField, // 确保你有这个组件，或者用 FormSwitchField
} from '@repo/ui';
import { useRequest } from 'ahooks';
import { Bot, Info } from 'lucide-react';

// 扩展 zod schema 类型以包含 bonus 字段 (如果 schema 没包含的话)
type ProductFormInputs = z.infer<typeof createProductSchema> & {
  bonusItemName?: string;
  bonusItemImg?: string | File;
  bonusWinnerCount?: number;
};

interface CreateProductFormModalProps {
  categories: Category[];
  confirm: () => void;
}

export const CreateProductFormModal: React.FC<CreateProductFormModalProps> = ({
  categories,
  confirm,
}) => {
  const addToast = useToastStore((s) => s.addToast);

  // 创建商品请求
  const { run: createProduct, loading } = useRequest(productApi.createProduct, {
    manual: true,
    onSuccess: () => {
      addToast('success', 'Product created successfully');
      confirm();
    },
  });

  // 上传请求
  const upload = useRequest(uploadApi.uploadMedia, {
    manual: true,
  });

  // 富文本编辑器用的上传函数
  const handleEditorUpload = async (file: File): Promise<string> => {
    try {
      const res = await upload.runAsync(file);
      return res.url;
    } catch (error) {
      addToast('error', 'Failed to upload editor image');
      throw error;
    }
  };

  const form = useForm<ProductFormInputs>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      treasureName: '',
      seqShelvesQuantity: 0,

      // 价格
      unitAmount: 0, // 拼团价
      marketAmount: undefined, // 划线价
      soloAmount: undefined, // 单买价
      costAmount: 0, // 成本

      categoryIds: undefined,
      desc: '',
      ruleContent: '',
      treasureCoverImg: '',
      shippingType: 1,
      weight: 0,

      // 拼团与自动化
      groupSize: 5,
      groupTimeLimit: 86400,
      enableRobot: false, // 默认关闭
      robotDelay: 300, // 默认300秒

      salesStartAt: undefined,
      salesEndAt: undefined,

      // 赠品
      bonusItemName: '',
      bonusItemImg: '',
      bonusWinnerCount: 1,
      leaderBonusType: 0,
    },
  });

  const onSubmit = async (values: ProductFormInputs) => {
    try {
      // 1. 处理封面图上传
      let coverUrl: string = '';
      if (values.treasureCoverImg instanceof File) {
        const res = await upload.runAsync(values.treasureCoverImg);
        coverUrl = res.url;
      } else {
        coverUrl = values.treasureCoverImg as string;
      }

      // 2. 处理赠品图上传
      let bonusImgUrl: string = '';
      if (values.bonusItemImg instanceof File) {
        const res = await upload.runAsync(values.bonusItemImg);
        bonusImgUrl = res.url;
      } else if (typeof values.bonusItemImg === 'string') {
        bonusImgUrl = values.bonusItemImg;
      }

      // 3. 构建 Payload
      const payload: CreateProduct = {
        treasureName: values.treasureName,
        seqShelvesQuantity: Number(values.seqShelvesQuantity),
        categoryIds: [Number(values.categoryIds)],
        treasureCoverImg: coverUrl,
        desc: values.desc,
        ruleContent: values.ruleContent,

        // --- 价格体系 ---
        unitAmount: Number(values.unitAmount),
        costAmount: Number(values.costAmount),
        // 只有填了才传，避免传 0 或 NaN
        marketAmount:
          values.marketAmount !== undefined && values.marketAmount !== null
            ? Number(values.marketAmount)
            : undefined,
        soloAmount:
          values.soloAmount !== undefined && values.soloAmount !== null
            ? Number(values.soloAmount)
            : undefined,

        // --- 物流 ---
        shippingType: Number(values.shippingType),
        weight: Number(values.weight),

        // --- 拼团与自动化 ---
        groupSize: Number(values.groupSize),
        groupTimeLimit: Number(values.groupTimeLimit),
        enableRobot: Boolean(values.enableRobot),
        robotDelay: values.robotDelay ? Number(values.robotDelay) : 300,
        leaderBonusType: Number(values.leaderBonusType || 0),

        // --- 时间 ---
        salesStartAt: values.salesStartAt
          ? new Date(values.salesStartAt).getTime()
          : undefined,
        salesEndAt: values.salesEndAt
          ? new Date(values.salesEndAt).getTime()
          : undefined,

        // --- 赠品配置 ---
        bonusConfig: values.bonusItemName
          ? {
              bonusItemName: values.bonusItemName,
              bonusItemImg: bonusImgUrl,
              winnerCount: Number(values.bonusWinnerCount || 1),
              allowRobot: true,
            }
          : undefined,
      };

      await createProduct(payload);
    } catch (e) {
      // 4xx 由 HTTP 拦截器统一 toast，此处不重复 console.error
      const status = (e as { response?: { status?: number } })?.response
        ?.status;
      if (!status || status < 400 || status >= 500) console.error(e);
      addToast('error', 'Failed to save product');
    }
  };

  // 监听 enableRobot 字段，用于控制 robotDelay 的显示/隐藏
  const enableRobot = form.watch('enableRobot');

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6 h-[650px] overflow-y-auto px-1 scrollbar-thin scrollbar-thumb-gray-200"
      >
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6">
          {/* 左侧：主要表单区域 */}
          <div className="space-y-6">
            {/* 1. Basic Info */}
            <div className="space-y-4 p-4 border rounded-lg shadow-sm">
              <h3 className="font-semibold text-sm text-gray-900 flex items-center gap-2">
                📦 Basic Information
              </h3>
              <FormTextField
                required
                name="treasureName"
                label="Product Name"
                placeholder="e.g. Lucky Badge"
              />
              <div className="grid grid-cols-2 gap-4">
                <FormSelectField
                  required
                  name="categoryIds"
                  label="Category"
                  options={categories.map((c) => ({
                    label: c.name,
                    value: String(c.id),
                  }))}
                />
                <FormTextField
                  required
                  name="seqShelvesQuantity"
                  label="Stock (Shares)"
                  type="number"
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
                  helpText="The price for group buying."
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
                  label="Solo Price (Direct Buy)"
                  type="number"
                  placeholder="Optional"
                  helpText="Leave empty to disable solo buy."
                  renderRight={() => (
                    <span className="text-xs text-gray-500">₱</span>
                  )}
                />
                <FormTextField
                  name="marketAmount"
                  label="MSRP (Strikethrough)"
                  type="number"
                  placeholder="Optional"
                  helpText="Original price shown as crossed out."
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
                  helpText="People required to finish."
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
                    description="System will fill remaining spots automatically."
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
                ⏰ Sales Duration (Pre-sale)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormDateField
                  name="salesStartAt"
                  label="Start Time"
                  placeholder="Immediate"
                />
                <FormDateField
                  name="salesEndAt"
                  label="End Time"
                  placeholder="Unlimited"
                />
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
                />
              </div>
            </div>

            {/* 6. Rich Text Descriptions */}
            <div className="space-y-4">
              <FormRichTextField
                name="desc"
                label="Product Details"
                placeholder="Describe your product here..."
                onUpload={handleEditorUpload}
              />

              <FormRichTextField
                name="ruleContent"
                label="Rules & Terms"
                placeholder="Specific rules for this product..."
                onUpload={handleEditorUpload}
              />
            </div>
          </div>

          {/* 右侧：图片与赠品 (Sticky) */}
          <div className="flex flex-col gap-4">
            <div className="sticky top-0 space-y-4">
              {/* Main Image */}
              <div className="p-4 border rounded-lg  shadow-sm">
                <FormMediaUploaderField
                  name="treasureCoverImg"
                  label="Cover Image"
                  maxFileCount={1}
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
                <FormTextField
                  name="bonusItemName"
                  label="Item Name"
                  placeholder="e.g. iPhone 15"
                />
                <FormTextField
                  name="bonusWinnerCount"
                  label="Winners"
                  type="number"
                  placeholder="1"
                />
                <FormMediaUploaderField
                  name="bonusItemImg"
                  label="Prize Image"
                  maxFileCount={1}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 flex justify-end gap-3 sticky bottom-0  backdrop-blur-sm z-10 py-4 border-t border-gray-100">
          <Button variant="outline" onClick={() => confirm?.()}>
            Cancel
          </Button>
          <Button isLoading={loading || upload.loading} type="submit">
            Create Product
          </Button>
        </div>
      </form>
    </Form>
  );
};
