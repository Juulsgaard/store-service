import {MapFunc, WithId} from "@consensus-labs/ts-tools";
import {ListSelector} from "../models/store-types";

export class WhereItem {

  /**
   * Select item with ID equal to the payload
   */
  static IdMatchesPayload(): ListSelector<WithId, string, any>
  /**
   * Select element with ID equal to mapped payload
   * @param payloadId - Map payload to ID
   */
  static IdMatchesPayload<TPayload>(payloadId: MapFunc<TPayload, string>): ListSelector<WithId, TPayload, any>
  static IdMatchesPayload<TPayload>(payloadId?: MapFunc<TPayload|string, string>): ListSelector<WithId, TPayload, any> {
    const getPayloadId = payloadId ?? (x => x);
    return (data, payload) => {
      const id = getPayloadId(payload);
      return (element) => element.id === id;
    };
  }

  /**
   * Select item where element matches payload
   */
  static MatchesPayload<TElement>(): ListSelector<TElement, TElement, any>
  /**
   * Select item where element selector matches payload
   * @param elementId - Map ID from element
   */
  static MatchesPayload<TElement, TPayload>(elementId: MapFunc<TElement, TPayload>): ListSelector<TElement, TPayload, any>
  /**
   * Select item where element selector matches payload selector
   * @param payloadId - Map ID from payload
   * @param elementId - Map ID from element
   */
  static MatchesPayload<TElement, TPayload, TId>(elementId: MapFunc<TElement, TId>, payloadId: MapFunc<TPayload, TId>): ListSelector<TElement, TPayload, any>
  static MatchesPayload<TElement, TPayload, TId>(elementId?: MapFunc<TElement, TId|TElement|TPayload>, payloadId?: MapFunc<TPayload, TId|TPayload>): ListSelector<TElement, TPayload, any> {
    const getPayloadId = payloadId ?? (x => x);
    const getElementId = elementId ?? (x => x);
    return (data, payload) => {
      const id = getPayloadId(payload);
      return (element) => getElementId(element) === id;
    };
  }

  /**
   * Select item with ID equal to the data
   */
  static IdMatchesData(): ListSelector<WithId, string, any>
  /**
   * Select element with ID equal to mapped data
   * @param dataId - Map data to ID
   */
  static IdMatchesData<TData>(dataId: MapFunc<TData, string>): ListSelector<WithId, any, TData>
  static IdMatchesData<TData>(dataId?: MapFunc<TData|string, string>): ListSelector<WithId, any, TData> {
    const getDataId = dataId ?? (x => x);
    return (data, payload) => {
      const id = getDataId(data);
      return (element) => element.id === id;
    };
  }

  /**
   * Select item where element matches data
   */
  static MatchesData<TElement>(): ListSelector<TElement, TElement, any>
  /**
   * Select item where element selector matches data
   * @param elementId - Map ID from element
   */
  static MatchesData<TElement, TData>(elementId: MapFunc<TElement, TData>): ListSelector<TElement, any, TData>
  /**
   * Select item where element selector matches data selector
   * @param dataId - Map ID from data
   * @param elementId - Map ID from element
   */
  static MatchesData<TElement, TData, TId>(elementId: MapFunc<TElement, TId>, dataId: MapFunc<TData, TId>): ListSelector<TElement, any, TData>
  static MatchesData<TElement, TData, TId>(elementId?: MapFunc<TElement, TId|TElement|TData>, dataId?: MapFunc<TData, TId|TData>): ListSelector<TElement, any, TData> {
    const getDataId = dataId ?? (x => x);
    const getElementId = elementId ?? (x => x);
    return (data) => {
      const id = getDataId(data);
      return (element) => getElementId(element) === id;
    };
  }
}
