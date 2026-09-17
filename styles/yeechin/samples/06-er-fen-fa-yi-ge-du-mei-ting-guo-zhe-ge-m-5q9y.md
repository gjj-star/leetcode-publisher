# 二分法：一个都没听过这个名词的人是怎么不小心用上它的

> Problem: [1011. 在 D 天内送达包裹的能力](https://leetcode.cn/problems/capacity-to-ship-packages-within-d-days/description/)

# 思路

> 你选用何种方法解题？

二分法。不过我刷到这题的时候根本不知道有这个词，是写完去对题解才发现"哦原来这玩意有名字"。

这是我的第二道题（第一题写的是abandon，感兴趣的可以翻我上篇题解），随机到的。看到"求最小的运载能力"，1KB 小脑的第一反应很朴素：

> 答案肯定在某个范围里吧？那我从最小到最大一个个试，总能试出来。

试是可以试，就是有点蠢。然后盯着看了一会发现一个规律：船越大，天数越少。容量加到某个程度之后，天数就再也降不下去了。既然越大越轻松，那"刚好够用"的那个容量就在中间某个位置——那还一个个试啥，直接对半切啊。

# 解题过程

> 这些方法具体怎么运用？

## 第一步：先框住答案的范围

- 最小也得装得下最重的包裹：left = max(weights)（不然那个包裹这辈子上不了船）；

- 最大就是一次全拉走：right = sum(weights)。

## 第二步：给定容量，算算要几天

一开始我以为这里要动点脑子安排包裹，后来发现想多了——题目要求按顺序装，不能调整，所以"能装就装、装不下换明天"就是唯一玩法，遍历一遍天数就出来了：

`day = 1, 船上已有 0`

`每个包裹：装得下 → 装；装不下 → day + 1，它坐明天的船`

## 第三步：踩了个坑，== 改 <=

我最开始写的是"找天数刚好等于 days 的最小容量"，测试直接挂。想了下发现：天数根本不是连续变化的，容量 30 和 31 可能要的天数一模一样，"刚好等于 days"的容量可能压根不存在。改成 check(容量) <= days（够用就行，哪怕有富余）就通了。

## 第四步：对半切

天数随容量单调递减，所以：

- check(mid) <= days：容量够用 → 答案只可能更小 → right = mid - 1

- check(mid) > days：容量不够 → 答案只能更大 → left = mid + 1

切完 left 停在的位置就是最小可行容量。

# 复杂度

- 时间复杂度: $O(n log S)$|每次 check 要遍历一遍数组 O(n)，二分一共切 log S 次（S 是sum(weights)）
- 空间复杂度: $O(1)$
- 代码复杂度：害彳亍

# Code

```python3 []
class Solution:
    def shipWithinDays(self, weights: List[int], days: int) -> int:
        # 判断当前船容量 capacity 是否能在 days 天内完成运输
        def check(capacity):
            day = 1              # 当前已经用了几天
            current_weight = 0    # 当前这一天船上的重量

            for weight in weights:

                # 如果装上这个包裹不会超过容量
                if current_weight + weight <= capacity:
                    current_weight += weight

                # 如果超过容量，只能换一天
                else:
                    day += 1
                    current_weight = weight

            return day


        # 船的最低容量：
        # 至少能装下最重的包裹
        left = max(weights)

        # 船的最高容量：
        # 一次装完所有包裹
        right = sum(weights)


        # 二分寻找最小可行容量
        while left <= right:

            mid = (left + right) // 2

            # 如果这个容量够用
            if check(mid) <= days:

                # 尝试更小的容量
                right = mid - 1

            # 如果容量不够
            else:

                # 增大容量
                left = mid + 1


        # 循环结束时 left 就是最小可行容量
        return left
```

```typescript []
function shipWithinDays(weights: number[], days: number): number {

    // 判断容量 capacity 是否可行
    function check(capacity: number): number {

        let day = 1;
        let currentWeight = 0;

        for (const weight of weights) {

            // 当前船还能装
            if (currentWeight + weight <= capacity) {
                currentWeight += weight;
            }

            // 装不下，换一天
            else {
                day++;
                currentWeight = weight;
            }
        }

        return day;
    }


    // 最小容量：
    // 最大包裹重量
    let left = Math.max(...weights);


    // 最大容量：
    // 所有包裹一次装走
    let right = weights.reduce(
        (sum, weight) => sum + weight,
        0
    );


    // 二分答案
    while (left <= right) {

        const mid = Math.floor((left + right) / 2);


        // 当前容量可行
        if (check(mid) <= days) {

            // 往左找更小答案
            right = mid - 1;

        } else {

            // 当前容量太小
            left = mid + 1;
        }
    }


    return left;
}
```
