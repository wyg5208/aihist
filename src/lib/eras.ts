export type EraKind = "foundation" | "boom" | "winter";

/**
 * The archive opens with Torres Quevedo's chess automaton rather than with
 * Dartmouth: nine of the seeded entries predate 1950, so the masthead, the footer
 * and the earliest era band all have to agree on this number.
 */
export const ARCHIVE_START_YEAR = 1912;

export interface Era {
  from: number;
  kind: EraKind;
  title: string;
  text: string;
}

export const ERAS: Era[] = [
  {
    from: 2026,
    kind: "boom",
    title: "前沿模型与智能体",
    text: "模型迭代以季度计，智能体协议、算力合作与安全治理同时展开。开源权重继续逼近闭源前沿。",
  },
  {
    from: 2025,
    kind: "boom",
    title: "推理模型与开源追赶",
    text: "长思考与工具调用成为默认能力，开源权重模型在基准与成本上快速逼近，监管进入执行阶段。",
  },
  {
    from: 2024,
    kind: "boom",
    title: "多模态与监管落地",
    text: "原生多模态、视频生成和推理模型相继出现，欧盟《人工智能法案》完成立法程序。",
  },
  {
    from: 2023,
    kind: "boom",
    title: "生成式 AI 的扩散",
    text: "GPT-4、Claude、Llama 与 Mistral 形成多极格局，生成式 AI 从演示进入产品与监管议程。",
  },
  {
    from: 2022,
    kind: "boom",
    title: "对话式 AI 的转折",
    text: "扩散模型与对齐方法成熟，ChatGPT 把大模型带进普通人的日常界面。",
  },
  {
    from: 2020,
    kind: "boom",
    title: "规模化预训练与科学应用",
    text: "参数与数据规模持续放大，蛋白质结构预测等科学应用证明了大模型的通用潜力。",
  },
  {
    from: 2017,
    kind: "boom",
    title: "Transformer 与预训练",
    text: "注意力机制取代循环结构，预训练加微调成为新的通用范式。",
  },
  {
    from: 2012,
    kind: "boom",
    title: "深度学习复兴",
    text: "GPU、大数据与更深网络共同推动识别、语音与游戏领域的突破。",
  },
  {
    from: 1997,
    kind: "boom",
    title: "统计学习与算力",
    text: "统计方法取代手工规则，棋类与问答系统展示了专用算力的上限。",
  },
  {
    from: 1993,
    kind: "boom",
    title: "统计学习与概率方法",
    text: "支持向量机把间隔与核方法带入主流，概率图模型与贝叶斯方法重构语音、视觉与文本处理。AI 从规则工程转向以数据和统计推断为中心。",
  },
  {
    from: 1987,
    kind: "winter",
    title: "第二次低谷：专家系统退潮",
    text: "专用 Lisp 机器市场崩溃，专家系统的维护成本超出预期，日本第五代计划收缩。神经网络与统计方法在低谷中积蓄力量，LeNet 与 TD-Gammon 已经证明学习路线可行。",
  },
  {
    from: 1980,
    kind: "boom",
    title: "专家系统繁荣",
    text: "XCON 等系统进入企业生产流程，专家系统形成产业；反向传播让多层网络重新可训练，日本启动第五代计算机计划，各国跟进投入。",
  },
  {
    from: 1974,
    kind: "winter",
    title: "第一次低谷：经费收缩",
    text: "《莱特希尔报告》与 DARPA 的路线调整让通用 AI 经费大幅收缩，研究转向窄领域应用。MYCIN 等专家系统在此期间积累成果，符号主义的承诺兑现得慢于预期。",
  },
  {
    from: 1950,
    kind: "foundation",
    title: "学科诞生与两条路线",
    text: "从图灵测试到达特茅斯会议，AI 作为学科诞生；Lisp、GPS 与 SHRDLU 确立符号推理路线，感知机开启连接主义的第一轮热潮。",
  },
  {
    from: 1912,
    kind: "foundation",
    title: "前史：自动机与可计算性",
    text: "在计算机出现之前，机械自动机、形式逻辑与可计算性理论先铺好道路：象棋自动机演示机械决策，《R.U.R.》把「机器人」写进语汇，哥德尔与图灵划定形式系统的边界，形式神经元与赫布规则给出学习的第一种描述。",
  },
];

export function eraFor(year: number): Era {
  return ERAS.find((era) => year >= era.from) || ERAS[ERAS.length - 1];
}
