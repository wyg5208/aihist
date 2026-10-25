export interface Era {
  from: number;
  title: string;
  text: string;
}

export const ERAS: Era[] = [
  {
    from: 2026,
    title: "前沿模型与智能体",
    text: "模型迭代以季度计，智能体协议、算力合作与安全治理同时展开。开源权重继续逼近闭源前沿。",
  },
  {
    from: 2025,
    title: "推理模型与开源追赶",
    text: "长思考与工具调用成为默认能力，开源权重模型在基准与成本上快速逼近，监管进入执行阶段。",
  },
  {
    from: 2024,
    title: "多模态与监管落地",
    text: "原生多模态、视频生成和推理模型相继出现，欧盟《人工智能法案》完成立法程序。",
  },
  {
    from: 2023,
    title: "生成式 AI 的扩散",
    text: "GPT-4、Claude、Llama 与 Mistral 形成多极格局，生成式 AI 从演示进入产品与监管议程。",
  },
  {
    from: 2022,
    title: "对话式 AI 的转折",
    text: "扩散模型与对齐方法成熟，ChatGPT 把大模型带进普通人的日常界面。",
  },
  {
    from: 2020,
    title: "规模化预训练与科学应用",
    text: "参数与数据规模持续放大，蛋白质结构预测等科学应用证明了大模型的通用潜力。",
  },
  {
    from: 2017,
    title: "Transformer 与预训练",
    text: "注意力机制取代循环结构，预训练加微调成为新的通用范式。",
  },
  {
    from: 2012,
    title: "深度学习复兴",
    text: "GPU、大数据与更深网络共同推动识别、语音与游戏领域的突破。",
  },
  {
    from: 1997,
    title: "统计学习与算力",
    text: "统计方法取代手工规则，棋类与问答系统展示了专用算力的上限。",
  },
  {
    from: 1950,
    title: "符号主义与神经网络",
    text: "从图灵测试到达特茅斯会议，AI 作为学科诞生，并在两次热潮与寒冬之间前行。",
  },
];

export function eraFor(year: number): Era {
  return ERAS.find((era) => year >= era.from) || ERAS[ERAS.length - 1];
}
